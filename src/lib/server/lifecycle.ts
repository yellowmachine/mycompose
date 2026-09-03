import { eq } from 'drizzle-orm';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { composeArgv } from './compose';
import { appDataDir, appEnvFile, appRepoDir } from './config';
import { db } from './db';
import { apps } from './db/schema';
import { abortApp } from './jobs/queue';
import { resolveInside } from './paths';
import { runCommand } from './process';

const COMPOSE_LIFECYCLE_TIMEOUT_MS = 60_000;

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export type LifecycleApp = {
	id: string;
	slug: string;
	composePath: string;
};

async function runLifecycleCompose(
	app: LifecycleApp,
	command: 'stop' | 'start' | 'down'
): Promise<void> {
	const repoRoot = appRepoDir(app.slug);
	const envFile = appEnvFile(app.slug);
	if (!(await exists(repoRoot))) {
		if (command === 'down') return;
		throw new Error('App has no checkout; deploy first');
	}
	const composeAbs = resolveInside(repoRoot, app.composePath);
	if (!(await exists(composeAbs))) {
		if (command === 'down') return;
		throw new Error(`Compose file not found: ${app.composePath}`);
	}
	if (!(await exists(envFile))) {
		await mkdir(appDataDir(app.slug), { recursive: true });
		await writeFile(envFile, '', 'utf8');
	}

	let output = '';
	const argv = composeArgv({
		slug: app.slug,
		repoRoot,
		composePath: composeAbs,
		envFile,
		command
	});
	const result = await runCommand(['docker', ...argv], {
		cwd: repoRoot,
		timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
		onChunk: (chunk) => {
			output += chunk;
		}
	});
	if (result.code !== 0) {
		throw new Error(
			`docker compose ${command} exited ${result.code}${output.trim() ? `: ${output.trim()}` : ''}`
		);
	}
}

export async function stopStack(app: LifecycleApp): Promise<void> {
	await runLifecycleCompose(app, 'stop');
	await db
		.update(apps)
		.set({ status: 'stopped', updatedAt: new Date() })
		.where(eq(apps.id, app.id));
}

export async function startStack(app: LifecycleApp): Promise<void> {
	await runLifecycleCompose(app, 'start');
	await db
		.update(apps)
		.set({ status: 'running', updatedAt: new Date() })
		.where(eq(apps.id, app.id));
}

export async function destroyStack(app: LifecycleApp): Promise<void> {
	await abortApp(app.id);
	await runLifecycleCompose(app, 'down');
	await db.delete(apps).where(eq(apps.id, app.id));
	await rm(appDataDir(app.slug), { recursive: true, force: true });
}
