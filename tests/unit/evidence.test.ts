import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
	COMPOSE_EXCERPT_CAP,
	EMPTY_LOG_ERROR,
	LOG_PROMPT_HEAD,
	LOG_PROMPT_TAIL,
	buildEvidencePack,
	envKeysOnly,
	excerptBytes,
	readComposeExcerpt,
	shortenLog,
	type EvidenceApp,
	type EvidenceDeploy
} from '../../src/lib/server/ai/evidence';
import { explanationJsonSchema, explanationSchema } from '../../src/lib/server/ai/schema';

const secret = 'hunter2-should-never-leak';

function sampleApp(): EvidenceApp {
	return {
		name: 'Demo',
		slug: 'demo',
		gitUrl: 'https://github.com/example/demo.git',
		branch: 'main',
		composePath: 'docker-compose.yml',
		status: 'failed',
		liveSha: null
	};
}

function sampleDeploy(over: Partial<EvidenceDeploy> = {}): EvidenceDeploy {
	return {
		id: '11111111-1111-1111-1111-111111111111',
		sha: 'abc',
		branch: 'main',
		composePath: 'docker-compose.yml',
		status: 'failed',
		errorSummary: 'compose failed',
		startedAt: new Date('2026-09-03T12:00:00.000Z'),
		finishedAt: new Date('2026-09-03T12:00:01.000Z'),
		logText: 'yaml: line 1: did not find expected key',
		logTruncated: false,
		envSnapshot: { POSTGRES_PASSWORD: secret, FOO: 'bar' },
		...over
	};
}

describe('explanationSchema', () => {
	test('accepts a valid payload', () => {
		const parsed = explanationSchema.safeParse({
			cause_class: 'compose',
			summary: 'The compose file is invalid YAML.',
			evidence: ['yaml: line 1: did not find expected key'],
			next_checks: ['Open the compose path in the app form and fix the YAML.'],
			confidence: 'high'
		});
		expect(parsed.success).toBe(true);
	});

	test('rejects an unknown cause_class', () => {
		expect(
			explanationSchema.safeParse({
				cause_class: 'dns',
				summary: 'x',
				evidence: ['a'],
				next_checks: ['b'],
				confidence: 'low'
			}).success
		).toBe(false);
	});

	test('json schema lists cause_class values', () => {
		const schema = explanationJsonSchema();
		const props = schema.properties as Record<string, { enum?: string[] }>;
		expect(props.cause_class?.enum).toContain('compose');
		expect(props.confidence?.enum).toEqual(['low', 'medium', 'high']);
	});
});

describe('envKeysOnly', () => {
	test('returns sorted keys and drops values', () => {
		expect(envKeysOnly({ POSTGRES_PASSWORD: secret, FOO: 'bar' })).toEqual([
			'FOO',
			'POSTGRES_PASSWORD'
		]);
	});
});

describe('buildEvidencePack', () => {
	test('never emits env values', () => {
		const result = buildEvidencePack({ app: sampleApp(), deploy: sampleDeploy() });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const json = JSON.stringify(result.pack);
		expect(json).not.toContain(secret);
		expect(json).not.toContain('bar');
		expect(result.pack.env_keys).toEqual(['FOO', 'POSTGRES_PASSWORD']);
		expect(result.pack).not.toHaveProperty('env_snapshot');
		expect(result.pack).not.toHaveProperty('envSnapshot');
	});

	test('detects an empty log', () => {
		const result = buildEvidencePack({
			app: sampleApp(),
			deploy: sampleDeploy({ logText: '   \n' })
		});
		expect(result).toEqual({ ok: false, error: EMPTY_LOG_ERROR });
	});

	test('sets log_prompt_truncated when the log exceeds the prompt window', () => {
		const logText = 'H'.repeat(LOG_PROMPT_HEAD) + 'MID' + 'T'.repeat(LOG_PROMPT_TAIL);
		const result = buildEvidencePack({
			app: sampleApp(),
			deploy: sampleDeploy({ logText, logTruncated: true })
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pack.log_prompt_truncated).toBe(true);
		expect(result.pack.deploy.log_truncated).toBe(true);
		expect(result.pack.deploy.log).toContain('[log truncated for prompt]');
		expect(result.pack.deploy.log.startsWith('H'.repeat(32))).toBe(true);
		expect(result.pack.deploy.log.endsWith('T'.repeat(32))).toBe(true);
		expect(result.pack.deploy.log).not.toContain('MID');
	});

	test('does not mark a short log as prompt-truncated', () => {
		expect(shortenLog('short')).toEqual({ text: 'short', truncated: false });
		const result = buildEvidencePack({ app: sampleApp(), deploy: sampleDeploy() });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pack.log_prompt_truncated).toBe(false);
		expect(result.pack.deploy_finished).toBe(true);
	});
});

describe('readComposeExcerpt', () => {
	test('includes a file inside the repo and rejects path escape', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'mycompose-pack-'));
		try {
			await writeFile(
				path.join(dir, 'docker-compose.yml'),
				'services:\n  web:\n    image: nginx\n'
			);
			const ok = await readComposeExcerpt(dir, 'docker-compose.yml');
			expect(ok).toEqual({
				body: 'services:\n  web:\n    image: nginx\n',
				truncated: false
			});
			expect(await readComposeExcerpt(dir, '../secret.yml')).toBeNull();
			expect(await readComposeExcerpt(dir, 'missing.yml')).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('flags a compose excerpt over the byte cap', () => {
		const body = 'x'.repeat(COMPOSE_EXCERPT_CAP + 10);
		const excerpt = excerptBytes(body, COMPOSE_EXCERPT_CAP);
		expect(excerpt.truncated).toBe(true);
		expect(excerpt.body.length).toBe(COMPOSE_EXCERPT_CAP);
	});
});
