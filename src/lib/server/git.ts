import { rm, mkdir } from 'node:fs/promises';
import { runCommand } from './process';

const LS_REMOTE_TIMEOUT_MS = 30_000;
const CLONE_TIMEOUT_MS = 120_000;

export async function resolveBranchSha(
	url: string,
	branch: string,
	signal?: AbortSignal
): Promise<string> {
	let out = '';
	const result = await runCommand(['git', 'ls-remote', url, `refs/heads/${branch}`], {
		timeoutMs: LS_REMOTE_TIMEOUT_MS,
		signal,
		onChunk: (chunk) => {
			out += chunk;
		}
	});
	if (result.code !== 0) {
		throw new Error(`git ls-remote failed for ${url} (branch ${branch})`);
	}
	const line = out
		.trim()
		.split('\n')
		.find((l) => l.includes(`refs/heads/${branch}`));
	const sha = line?.split(/\s+/)[0];
	if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
		throw new Error(`Branch not found: ${branch}`);
	}
	return sha.toLowerCase();
}

export async function cloneSha(
	url: string,
	sha: string,
	dest: string,
	signal?: AbortSignal
): Promise<void> {
	await rm(dest, { recursive: true, force: true });
	await mkdir(dest, { recursive: true });

	const git = async (args: string[], timeoutMs = 30_000) => {
		let out = '';
		const result = await runCommand(['git', ...args], {
			cwd: dest,
			timeoutMs,
			signal,
			onChunk: (c) => {
				out += c;
			}
		});
		if (result.code !== 0) {
			throw new Error(`git ${args[0]} failed: ${out.trim() || `exit ${result.code}`}`);
		}
	};

	await git(['init']);
	await git(['remote', 'add', 'origin', url]);
	try {
		await git(['fetch', '--depth', '1', 'origin', sha], CLONE_TIMEOUT_MS);
	} catch {
		await git(['fetch', 'origin', sha], CLONE_TIMEOUT_MS);
	}
	await git(['checkout', '--detach', 'FETCH_HEAD']);
}
