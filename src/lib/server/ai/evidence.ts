import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import type { RuntimeSnapshot } from '../../runtime';
import { composeArgv } from '../compose';
import { appEnvFile, appRepoDir } from '../config';
import { projectRuntime } from '../docker';
import { resolveInside } from '../paths';
import { runCommand } from '../process';

export const LOG_PROMPT_HEAD = 32 * 1024;
export const LOG_PROMPT_TAIL = 32 * 1024;
export const COMPOSE_EXCERPT_CAP = 64 * 1024;
export const EMPTY_LOG_ERROR = 'No log to explain';

export type EvidenceApp = {
	name: string;
	slug: string;
	gitUrl: string;
	branch: string;
	composePath: string;
	status: string;
	liveSha: string | null;
};

export type EvidenceDeploy = {
	id: string;
	sha: string | null;
	branch: string;
	composePath: string;
	status: string;
	errorSummary: string | null;
	startedAt: Date | string;
	finishedAt: Date | string | null;
	logText: string;
	logTruncated: boolean;
	envSnapshot: unknown;
};

export type ComposeExcerpt = { body: string; truncated: boolean };

export type EvidencePack = {
	app: {
		name: string;
		slug: string;
		git_url: string;
		branch: string;
		compose_path: string;
		status: string;
		live_sha: string | null;
	};
	deploy: {
		id: string;
		sha: string | null;
		branch: string;
		compose_path: string;
		status: string;
		error_summary: string | null;
		started_at: string;
		finished_at: string | null;
		log: string;
		log_truncated: boolean;
	};
	env_keys: string[];
	deploy_finished: boolean;
	log_prompt_truncated: boolean;
	compose_excerpt?: ComposeExcerpt;
	runtime?: RuntimeSnapshot;
	docker_unavailable?: boolean;
	container_logs?: string;
};

export type PackResult =
	{ ok: true; pack: EvidencePack } | { ok: false; error: typeof EMPTY_LOG_ERROR };

function iso(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function envKeysOnly(snapshot: unknown): string[] {
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
	return Object.keys(snapshot as Record<string, unknown>).sort();
}

export function shortenLog(text: string): { text: string; truncated: boolean } {
	const cap = LOG_PROMPT_HEAD + LOG_PROMPT_TAIL;
	if (text.length <= cap) return { text, truncated: false };
	return {
		text:
			text.slice(0, LOG_PROMPT_HEAD) +
			'\n\n[log truncated for prompt]\n\n' +
			text.slice(-LOG_PROMPT_TAIL),
		truncated: true
	};
}

export function excerptBytes(body: string, cap: number): ComposeExcerpt {
	if (body.length <= cap) return { body, truncated: false };
	return { body: body.slice(0, cap), truncated: true };
}

export function buildEvidencePack(input: {
	app: EvidenceApp;
	deploy: EvidenceDeploy;
	composeExcerpt?: ComposeExcerpt | null;
	runtime?: RuntimeSnapshot | null;
	containerLogs?: string | null;
}): PackResult {
	if (!input.deploy.logText.trim()) {
		return { ok: false, error: EMPTY_LOG_ERROR };
	}

	const log = shortenLog(input.deploy.logText);
	const pack: EvidencePack = {
		app: {
			name: input.app.name,
			slug: input.app.slug,
			git_url: input.app.gitUrl,
			branch: input.app.branch,
			compose_path: input.app.composePath,
			status: input.app.status,
			live_sha: input.app.liveSha
		},
		deploy: {
			id: input.deploy.id,
			sha: input.deploy.sha,
			branch: input.deploy.branch,
			compose_path: input.deploy.composePath,
			status: input.deploy.status,
			error_summary: input.deploy.errorSummary,
			started_at: iso(input.deploy.startedAt) ?? new Date(0).toISOString(),
			finished_at: iso(input.deploy.finishedAt),
			log: log.text,
			log_truncated: input.deploy.logTruncated
		},
		env_keys: envKeysOnly(input.deploy.envSnapshot),
		deploy_finished: input.deploy.status === 'succeeded' || input.deploy.status === 'failed',
		log_prompt_truncated: log.truncated
	};

	if (input.composeExcerpt) pack.compose_excerpt = input.composeExcerpt;
	if (input.runtime) {
		pack.docker_unavailable = input.runtime.dockerUnavailable;
		if (!input.runtime.dockerUnavailable) pack.runtime = input.runtime;
	}
	if (input.containerLogs) pack.container_logs = input.containerLogs;

	return { ok: true, pack };
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export async function readComposeExcerpt(
	repoRoot: string,
	composePath: string
): Promise<ComposeExcerpt | null> {
	try {
		const abs = resolveInside(repoRoot, composePath);
		const body = await readFile(abs, 'utf8');
		return excerptBytes(body, COMPOSE_EXCERPT_CAP);
	} catch {
		return null;
	}
}

async function snapshotComposeLogs(slug: string, composePath: string): Promise<string | null> {
	const repoRoot = appRepoDir(slug);
	const envFile = appEnvFile(slug);
	if (!(await exists(repoRoot)) || !(await exists(envFile))) return null;
	try {
		const composeAbs = resolveInside(repoRoot, composePath);
		if (!(await exists(composeAbs))) return null;
		let text = '';
		await runCommand(
			[
				'docker',
				...composeArgv({
					slug,
					repoRoot,
					composePath: composeAbs,
					envFile,
					command: 'logs',
					extra: ['--no-color', '--tail', '200']
				})
			],
			{
				cwd: repoRoot,
				timeoutMs: 5000,
				onChunk: (chunk) => {
					text += chunk;
				}
			}
		);
		return text.trim() ? text : null;
	} catch {
		return null;
	}
}

export async function gatherEvidenceExtras(
	slug: string,
	composePath: string
): Promise<{
	composeExcerpt: ComposeExcerpt | null;
	runtime: RuntimeSnapshot | null;
	containerLogs: string | null;
}> {
	const composeExcerpt = await readComposeExcerpt(appRepoDir(slug), composePath);
	let runtime: RuntimeSnapshot;
	try {
		runtime = await projectRuntime(slug);
	} catch {
		runtime = { dockerUnavailable: true, services: [] };
	}

	let containerLogs: string | null = null;
	if (runtime && !runtime.dockerUnavailable) {
		containerLogs = await snapshotComposeLogs(slug, composePath);
	}

	return { composeExcerpt, runtime, containerLogs };
}
