import { dockerSock } from './config';

function unixFetch(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`http://localhost${path}`, { ...init, unix: dockerSock() });
}

export async function dockerExecCreate(
	containerId: string,
	body: Record<string, unknown>
): Promise<string> {
	const res = await unixFetch(`/containers/${encodeURIComponent(containerId)}/exec`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const json = (await res.json()) as { Id?: string; message?: string };
	if (!res.ok || !json.Id) {
		throw new Error(json.message || `exec create failed (${res.status})`);
	}
	return json.Id;
}

export async function dockerExecInspect(
	execId: string
): Promise<{ Running: boolean; ExitCode: number | null }> {
	const res = await unixFetch(`/exec/${encodeURIComponent(execId)}/json`);
	if (!res.ok) throw new Error(`exec inspect failed (${res.status})`);
	return res.json() as Promise<{ Running: boolean; ExitCode: number | null }>;
}

export async function dockerExecResize(execId: string, cols: number, rows: number): Promise<void> {
	await unixFetch(
		`/exec/${encodeURIComponent(execId)}/resize?h=${encodeURIComponent(String(rows))}&w=${encodeURIComponent(String(cols))}`,
		{ method: 'POST' }
	);
}

export async function commandExists(containerId: string, cmd: string): Promise<boolean> {
	try {
		const execId = await dockerExecCreate(containerId, {
			AttachStdout: true,
			AttachStderr: true,
			Tty: false,
			Cmd: [cmd, '-c', 'exit 0']
		});
		const start = await unixFetch(`/exec/${encodeURIComponent(execId)}/start`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ Detach: false, Tty: false }),
			signal: AbortSignal.timeout(5000)
		});
		await start.arrayBuffer();
		const info = await dockerExecInspect(execId);
		return info.ExitCode === 0;
	} catch {
		return false;
	}
}

export type HijackSession = {
	write(data: string | ArrayBuffer | Uint8Array): void;
	end(): void;
};

function headerEnd(buf: Buffer): number {
	for (let i = 0; i < buf.length - 3; i++) {
		if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
			return i;
		}
	}
	return -1;
}

export async function hijackExecTty(
	execId: string,
	handlers: {
		onData: (data: Uint8Array) => void;
		onClose: () => void;
		onError: (error: Error) => void;
	}
): Promise<HijackSession> {
	let headerBuf = Buffer.alloc(0);
	let headersDone = false;

	const socket = await Bun.connect({
		unix: dockerSock(),
		socket: {
			open(s) {
				const payload = JSON.stringify({ Detach: false, Tty: true });
				s.write(
					`POST /exec/${execId}/start HTTP/1.1\r\n` +
						`Host: docker\r\n` +
						`Content-Type: application/json\r\n` +
						`Connection: Upgrade\r\n` +
						`Upgrade: tcp\r\n` +
						`Content-Length: ${payload.length}\r\n` +
						`\r\n` +
						payload
				);
			},
			data(_s, data) {
				const chunk = Buffer.from(data);
				if (!headersDone) {
					headerBuf = Buffer.concat([headerBuf, chunk]);
					const idx = headerEnd(headerBuf);
					if (idx === -1) return;
					const statusLine = headerBuf.subarray(0, idx).toString('utf8').split('\r\n')[0] ?? '';
					headersDone = true;
					const rest = headerBuf.subarray(idx + 4);
					headerBuf = Buffer.alloc(0);
					if (!statusLine.includes('101') && !statusLine.includes('200')) {
						handlers.onError(new Error(statusLine || 'exec start failed'));
						return;
					}
					if (rest.length) handlers.onData(rest);
					return;
				}
				handlers.onData(chunk);
			},
			close() {
				handlers.onClose();
			},
			error(_s, error) {
				handlers.onError(error instanceof Error ? error : new Error(String(error)));
			}
		}
	});

	return {
		write(data) {
			socket.write(data);
		},
		end() {
			try {
				socket.end();
			} catch {
				// already closed
			}
		}
	};
}
