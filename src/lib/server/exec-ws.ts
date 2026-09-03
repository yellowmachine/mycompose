import type { ServerWebSocket } from 'bun';
import { SLUG_RE } from '../slug';
import {
	commandExists,
	dockerExecCreate,
	dockerExecResize,
	hijackExecTty,
	type HijackSession
} from './docker-exec';
import { findRunningServiceContainer, pingDocker } from './docker';

const SERVICE_RE = /^[a-zA-Z0-9._-]+$/;
const EXEC_PATH = /^\/ws\/apps\/([^/]+)\/services\/([^/]+)\/exec$/;
const SHELLS = ['/bin/sh', '/bin/bash'] as const;

export type ExecSocketData = {
	slug: string;
	service: string;
	cols: number;
	rows: number;
	containerId: string;
	execId?: string;
	session?: HijackSession;
	pending: Array<string | Uint8Array>;
};

export function parseExecPath(pathname: string): { slug: string; service: string } | null {
	const match = pathname.match(EXEC_PATH);
	if (!match) return null;
	const slug = match[1];
	const service = match[2];
	if (!slug || !service || !SLUG_RE.test(slug) || !SERVICE_RE.test(service)) return null;
	return { slug, service };
}

export function parseResizeMessage(message: string): { cols: number; rows: number } | null {
	if (!message.startsWith('{')) return null;
	try {
		const parsed = JSON.parse(message) as { type?: unknown; cols?: unknown; rows?: unknown };
		if (parsed.type !== 'resize') return null;
		if (typeof parsed.cols !== 'number' || typeof parsed.rows !== 'number') return null;
		if (!Number.isFinite(parsed.cols) || !Number.isFinite(parsed.rows)) return null;
		return { cols: parsed.cols, rows: parsed.rows };
	} catch {
		return null;
	}
}

export async function pickShell(exists: (cmd: string) => Promise<boolean>): Promise<string> {
	for (const shell of SHELLS) {
		if (await exists(shell)) return shell;
	}
	throw new Error('No shell in this image (/bin/sh and /bin/bash are missing)');
}

function clamp(n: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

export async function prepareExecUpgrade(
	req: Request
): Promise<{ ok: true; data: ExecSocketData } | { ok: false; status: number; message: string }> {
	const url = new URL(req.url);
	const parsed = parseExecPath(url.pathname);
	if (!parsed) return { ok: false, status: 404, message: 'Not found' };

	const up = await pingDocker();
	if (!up) return { ok: false, status: 503, message: 'Docker is unavailable' };

	let found: { id: string } | null;
	try {
		found = await findRunningServiceContainer(parsed.slug, parsed.service);
	} catch {
		return { ok: false, status: 503, message: 'Docker is unavailable' };
	}
	if (!found) return { ok: false, status: 409, message: 'Service is not running' };

	return {
		ok: true,
		data: {
			slug: parsed.slug,
			service: parsed.service,
			cols: clamp(Number(url.searchParams.get('cols')), 20, 500, 80),
			rows: clamp(Number(url.searchParams.get('rows')), 8, 200, 24),
			containerId: found.id,
			pending: []
		}
	};
}

export async function handleExecHttp(
	req: Request,
	server: Bun.Server<ExecSocketData>
): Promise<Response | undefined> {
	const prepared = await prepareExecUpgrade(req);
	if (!prepared.ok) return new Response(prepared.message, { status: prepared.status });
	if (server.upgrade(req, { data: prepared.data })) return;
	return new Response('Upgrade failed', { status: 400 });
}

function sendError(ws: ServerWebSocket<ExecSocketData>, message: string) {
	try {
		ws.send(JSON.stringify({ type: 'error', message }));
	} catch {
		// socket already closing
	}
}

function closeSession(ws: ServerWebSocket<ExecSocketData>) {
	ws.data.session?.end();
	ws.data.session = undefined;
}

function writeStdin(ws: ServerWebSocket<ExecSocketData>, data: string | Uint8Array) {
	if (ws.data.session) {
		ws.data.session.write(data);
		return;
	}
	ws.data.pending.push(data);
}

async function attachExec(ws: ServerWebSocket<ExecSocketData>): Promise<void> {
	const shell = await pickShell((cmd) => commandExists(ws.data.containerId, cmd));
	const execId = await dockerExecCreate(ws.data.containerId, {
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: true,
		Cmd: [shell],
		Env: ['TERM=xterm-256color'],
		ConsoleSize: [ws.data.rows, ws.data.cols]
	});
	ws.data.execId = execId;
	const session = await hijackExecTty(execId, {
		onData: (data) => {
			if (ws.readyState === 1) ws.send(data);
		},
		onClose: () => {
			try {
				ws.close();
			} catch {
				// already closed
			}
		},
		onError: (error) => {
			sendError(ws, error.message);
			try {
				ws.close();
			} catch {
				// already closed
			}
		}
	});
	ws.data.session = session;
	for (const chunk of ws.data.pending) session.write(chunk);
	ws.data.pending = [];
	try {
		await dockerExecResize(execId, ws.data.cols, ws.data.rows);
	} catch {
		// resize is best-effort; the exec can still run
	}
}

export const execWebsocket: Bun.WebSocketHandler<ExecSocketData> = {
	async open(ws) {
		try {
			await attachExec(ws);
		} catch (error) {
			sendError(ws, error instanceof Error ? error.message : 'Failed to open exec session');
			ws.close();
		}
	},
	async message(ws, message) {
		if (typeof message === 'string') {
			const resize = parseResizeMessage(message);
			if (resize) {
				ws.data.cols = clamp(resize.cols, 20, 500, ws.data.cols);
				ws.data.rows = clamp(resize.rows, 8, 200, ws.data.rows);
				if (ws.data.execId) {
					try {
						await dockerExecResize(ws.data.execId, ws.data.cols, ws.data.rows);
					} catch {
						// ignore
					}
				}
				return;
			}
			writeStdin(ws, message);
			return;
		}
		writeStdin(ws, new Uint8Array(message));
	},
	close(ws) {
		closeSession(ws);
	}
};
