import { expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeGitRepo(fixtureDir: string): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'mycompose-'));
	await cp(fixtureDir, dir, { recursive: true });
	execSync(
		'git init -b main && git add . && git -c user.email=t@t.com -c user.name=t commit -m init',
		{ cwd: dir }
	);
	return dir;
}

export async function waitForAppStatus(page: Page, status: string, timeout = 120_000) {
	await expect(page.getByText(status, { exact: true }).first()).toBeVisible({ timeout });
}

export function downProject(slug: string) {
	try {
		execSync(`docker compose -p mycompose-${slug} down`, { stdio: 'ignore' });
	} catch {
		// project may not exist
	}
}

export async function removeRepo(repo: string) {
	await rm(repo, { recursive: true, force: true });
}

export function containerEnv(slug: string, key: string): string {
	const id = execSync(
		`docker ps -q -f label=com.docker.compose.project=mycompose-${slug} -f label=com.docker.compose.service=web`,
		{ encoding: 'utf8' }
	).trim();
	if (!id) throw new Error(`No running web container for mycompose-${slug}`);
	const env = execSync(
		`docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' ${id}`,
		{
			encoding: 'utf8'
		}
	);
	const line = env.split('\n').find((l) => l.startsWith(`${key}=`));
	if (!line) throw new Error(`${key} not set on container ${id}`);
	return line.slice(key.length + 1);
}
