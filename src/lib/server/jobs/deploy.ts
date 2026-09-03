import { eq } from 'drizzle-orm';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { db } from '$lib/server/db';
import { appEnvVars, apps, deploys } from '$lib/server/db/schema';
import { composeArgv } from '$lib/server/compose';
import { appDataDir, appEnvFile, appRepoDir } from '$lib/server/config';
import { serializeEnvFile } from '$lib/server/envfile';
import { cloneSha, resolveBranchSha } from '$lib/server/git';
import { appendLog } from '$lib/server/log';
import { resolveInside } from '$lib/server/paths';
import { runCommand } from '$lib/server/process';

const COMPOSE_UP_TIMEOUT_MS = 15 * 60 * 1000;

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function appendDeployLog(deployId: string, chunk: string): Promise<void> {
	const [row] = await db.select().from(deploys).where(eq(deploys.id, deployId)).limit(1);
	if (!row) return;
	const next = appendLog(row.logText, chunk, row.logTruncated);
	await db
		.update(deploys)
		.set({ logText: next.text, logTruncated: next.truncated })
		.where(eq(deploys.id, deployId));
}

export async function runDeploy(deployId: string, signal: AbortSignal): Promise<void> {
	const [deploy] = await db.select().from(deploys).where(eq(deploys.id, deployId)).limit(1);
	if (!deploy) return;

	const [app] = await db.select().from(apps).where(eq(apps.id, deploy.appId)).limit(1);
	if (!app) {
		await db
			.update(deploys)
			.set({
				status: 'failed',
				errorSummary: 'App not found',
				finishedAt: new Date()
			})
			.where(eq(deploys.id, deployId));
		return;
	}

	await db.update(deploys).set({ status: 'deploying' }).where(eq(deploys.id, deployId));
	await db
		.update(apps)
		.set({ status: 'deploying', updatedAt: new Date() })
		.where(eq(apps.id, app.id));

	const log = (chunk: string) => appendDeployLog(deployId, chunk);

	try {
		if (signal.aborted) throw new Error('Cancelled');
		await log(`Resolving ${app.gitUrl}#${app.branch}\n`);
		const sha = await resolveBranchSha(app.gitUrl, app.branch, signal);
		await db.update(deploys).set({ sha }).where(eq(deploys.id, deployId));
		await log(`Commit ${sha}\n`);

		const envRows = await db.select().from(appEnvVars).where(eq(appEnvVars.appId, app.id));
		const snapshot: Record<string, string> = {};
		for (const row of envRows) snapshot[row.key] = row.value;
		await db.update(deploys).set({ envSnapshot: snapshot }).where(eq(deploys.id, deployId));

		const repoRoot = appRepoDir(app.slug);
		const envFile = appEnvFile(app.slug);
		await mkdir(appDataDir(app.slug), { recursive: true });
		await writeFile(envFile, serializeEnvFile(snapshot), 'utf8');

		await log(`Cloning ${sha}\n`);
		await cloneSha(app.gitUrl, sha, repoRoot, signal);

		const composeAbs = resolveInside(repoRoot, app.composePath);
		if (!(await fileExists(composeAbs))) {
			throw new Error(`Compose file not found: ${app.composePath}`);
		}

		await log(`Running docker compose up --build\n`);
		const argv = composeArgv({
			slug: app.slug,
			repoRoot,
			composePath: composeAbs,
			envFile,
			command: 'up'
		});
		const result = await runCommand(['docker', ...argv], {
			cwd: repoRoot,
			timeoutMs: COMPOSE_UP_TIMEOUT_MS,
			signal,
			onChunk: log
		});
		if (result.code !== 0) {
			throw new Error(`docker compose up exited ${result.code}`);
		}

		await db
			.update(deploys)
			.set({ status: 'succeeded', finishedAt: new Date() })
			.where(eq(deploys.id, deployId));
		await db
			.update(apps)
			.set({ status: 'running', liveSha: sha, updatedAt: new Date() })
			.where(eq(apps.id, app.id));
		await log(`Deploy succeeded\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await log(`\nERROR: ${message}\n`);
		await db
			.update(deploys)
			.set({
				status: 'failed',
				errorSummary: message.slice(0, 500),
				finishedAt: new Date()
			})
			.where(eq(deploys.id, deployId));
		await db
			.update(apps)
			.set({ status: 'failed', updatedAt: new Date() })
			.where(eq(apps.id, app.id));
	}
}
