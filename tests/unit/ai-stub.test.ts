import { describe, expect, test } from 'vitest';
import {
	buildEvidencePack,
	type EvidenceApp,
	type EvidenceDeploy
} from '../../src/lib/server/ai/evidence';
import { classifyStubCause, stubExplain } from '../../src/lib/server/ai/stub';

function packFromLog(logText: string, errorSummary: string | null = null) {
	const app: EvidenceApp = {
		name: 'Demo',
		slug: 'demo',
		gitUrl: 'https://github.com/example/demo.git',
		branch: 'main',
		composePath: 'docker-compose.yml',
		status: 'failed',
		liveSha: null
	};
	const deploy: EvidenceDeploy = {
		id: '11111111-1111-1111-1111-111111111111',
		sha: null,
		branch: 'main',
		composePath: 'docker-compose.yml',
		status: 'failed',
		errorSummary,
		startedAt: new Date('2026-09-03T12:00:00.000Z'),
		finishedAt: new Date('2026-09-03T12:00:01.000Z'),
		logText,
		logTruncated: false,
		envSnapshot: { SECRET: 'must-not-appear-in-stub' }
	};
	const result = buildEvidencePack({ app, deploy });
	if (!result.ok) throw new Error(result.error);
	return result.pack;
}

describe('classifyStubCause', () => {
	test('maps yaml/compose and missing path to compose', () => {
		expect(classifyStubCause('yaml: line 1: did not find expected key')).toBe('compose');
		expect(classifyStubCause('no such file: docker-compose.yml')).toBe('compose');
		expect(classifyStubCause('docker compose failed')).toBe('compose');
	});

	test('maps git remote errors to git', () => {
		expect(classifyStubCause('fatal: ls-remote failed for origin')).toBe('git');
		expect(classifyStubCause('fatal: not a git repository')).toBe('git');
	});

	test('falls back to unknown', () => {
		expect(classifyStubCause('container healthy')).toBe('unknown');
	});
});

describe('stubExplain', () => {
	test('returns a compose explanation without env values', () => {
		const explained = stubExplain(packFromLog('yaml: line 1: mapping values are not allowed'));
		expect(explained.cause_class).toBe('compose');
		expect(explained.evidence[0]).toContain('yaml:');
		expect(JSON.stringify(explained)).not.toContain('must-not-appear-in-stub');
	});

	test('never calls a network API', () => {
		const explained = stubExplain(packFromLog('git ls-remote timed out', 'ls-remote failed'));
		expect(explained.cause_class).toBe('git');
		expect(explained.confidence).toBe('high');
	});
});
