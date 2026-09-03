import type { CauseClass } from '../db/schema';
import type { EvidencePack } from './evidence';
import type { ExplanationPayload } from './schema';

export const STUB_MODEL = 'stub';

export function aiStubEnabled(): boolean {
	const v = process.env.MYCOMPOSE_AI_STUB;
	return v === '1' || v === 'true';
}

function haystack(pack: EvidencePack): string {
	return [pack.deploy.log, pack.deploy.error_summary ?? '', pack.compose_excerpt?.body ?? '']
		.join('\n')
		.toLowerCase();
}

export function classifyStubCause(text: string): CauseClass {
	const t = text.toLowerCase();
	if (
		/\bls-remote\b/.test(t) ||
		/not a git repository/.test(t) ||
		/repository not found/.test(t) ||
		/could not read from remote/.test(t)
	) {
		return 'git';
	}
	if (/yaml:/.test(t) || /no such file/.test(t) || /\bcompose\b/.test(t)) {
		return 'compose';
	}
	return 'unknown';
}

function quote(pack: EvidencePack): string {
	const line =
		pack.deploy.error_summary?.trim() ||
		pack.deploy.log
			.split('\n')
			.map((l) => l.trim())
			.find((l) => l.length > 0) ||
		pack.deploy.status;
	return line.slice(0, 240);
}

export function stubExplain(pack: EvidencePack): ExplanationPayload {
	const cause = classifyStubCause(haystack(pack));
	const evidence = [quote(pack)];
	if (cause === 'git') {
		return {
			cause_class: 'git',
			summary: 'Git failed before Compose ran. Check the URL, branch, and that the repo is public.',
			evidence,
			next_checks: ['Fix the Git URL or branch on the app page and deploy again.'],
			confidence: 'high'
		};
	}
	if (cause === 'compose') {
		return {
			cause_class: 'compose',
			summary:
				'The compose file is invalid or missing. The deploy log names the YAML or path error.',
			evidence,
			next_checks: [
				'Open the compose path on the app form, fix the file in Git, and deploy again.'
			],
			confidence: 'high'
		};
	}
	return {
		cause_class: 'unknown',
		summary: 'The stub could not classify this deploy from the log keywords.',
		evidence,
		next_checks: ['Read the full deploy log on this page.'],
		confidence: 'low'
	};
}
