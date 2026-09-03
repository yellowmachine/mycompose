import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { composeArgv } from '$lib/server/compose';
import { appDataDir, appEnvFile, appRepoDir } from '$lib/server/config';
import { db } from '$lib/server/db';
import { apps } from '$lib/server/db/schema';
import { listProjectContainers } from '$lib/server/docker';
import { resolveInside } from '$lib/server/paths';
import { streamCommand } from '$lib/server/process';
import { sseEncoder, sseResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

const SERVICE_RE = /^[a-zA-Z0-9._-]+$/;

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) error(404, 'App not found');

	const service = url.searchParams.get('service') ?? '';
	if (service && !SERVICE_RE.test(service)) {
		error(400, 'Invalid service name');
	}

	const { pack } = sseEncoder();

	let running = false;
	try {
		const containers = await listProjectContainers(app.slug);
		running = containers.some((c) => c.State === 'running');
	} catch {
		// Docker inspect failed; treat as no running containers
	}

	if (!running) {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(pack({ empty: true }));
				controller.close();
			}
		});
		return sseResponse(stream);
	}

	const repoRoot = appRepoDir(app.slug);
	const envFile = appEnvFile(app.slug);
	const composeAbs = resolveInside(repoRoot, app.composePath);
	if (!(await exists(envFile))) {
		await mkdir(appDataDir(app.slug), { recursive: true });
		await writeFile(envFile, '', 'utf8');
	}
	if (!(await exists(repoRoot)) || !(await exists(composeAbs))) {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(pack({ empty: true }));
				controller.close();
			}
		});
		return sseResponse(stream);
	}

	const extra = ['--follow', '--tail', '200'];
	if (service) extra.push(service);
	const argv = composeArgv({
		slug: app.slug,
		repoRoot,
		composePath: composeAbs,
		envFile,
		command: 'logs',
		extra
	});

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				await streamCommand(['docker', ...argv], {
					cwd: repoRoot,
					signal: request.signal,
					onChunk: async (chunk) => {
						controller.enqueue(pack({ chunk }));
					}
				});
			} catch {
				if (!request.signal.aborted) {
					try {
						controller.enqueue(pack({ error: 'Log stream ended' }));
					} catch {
						// closed
					}
				}
			} finally {
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		}
	});

	return sseResponse(stream);
};
