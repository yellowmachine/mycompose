import { describe, expect, test } from 'vitest';
import {
	EMPTY_LOG_ERROR,
	type EvidenceApp,
	type EvidenceDeploy
} from '../../src/lib/server/ai/evidence';
import { explainDeploy, type ExplanationRow } from '../../src/lib/server/ai/explain';
import { ProviderError } from '../../src/lib/server/ai/provider';
import { coerceExplanation } from '../../src/lib/server/ai/schema';
import { stubExplain } from '../../src/lib/server/ai/stub';

const secret = 'should-not-be-inserted';

function app(): EvidenceApp {
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

function deploy(over: Partial<EvidenceDeploy> = {}): EvidenceDeploy {
	return {
		id: '11111111-1111-1111-1111-111111111111',
		sha: 'abc',
		branch: 'main',
		composePath: 'docker-compose.yml',
		status: 'failed',
		errorSummary: 'invalid compose',
		startedAt: new Date('2026-09-03T12:00:00.000Z'),
		finishedAt: new Date('2026-09-03T12:00:01.000Z'),
		logText: 'yaml: line 1: did not find expected key',
		logTruncated: false,
		envSnapshot: { TOKEN: secret },
		...over
	};
}

function saved(over: Partial<ExplanationRow> = {}): ExplanationRow {
	return {
		id: '22222222-2222-2222-2222-222222222222',
		deployId: deploy().id,
		causeClass: 'compose',
		summary: 'invalid YAML',
		evidence: ['yaml: line 1'],
		nextChecks: ['Fix the compose file'],
		confidence: 'high',
		model: 'stub',
		raw: null,
		createdAt: new Date('2026-09-03T12:00:02.000Z'),
		...over
	};
}

const noExtras = async () => ({
	composeExcerpt: null,
	runtime: null,
	containerLogs: null
});

describe('explainDeploy', () => {
	test('rejects an empty log without calling the model or inserting', async () => {
		let called = false;
		const result = await explainDeploy(app(), deploy({ logText: '  \n' }), {
			extras: noExtras,
			callModel: async () => {
				called = true;
				throw new Error('should not run');
			},
			persist: async () => {
				called = true;
				throw new Error('should not insert');
			}
		});
		expect(result).toEqual({ ok: false, error: EMPTY_LOG_ERROR, status: 400 });
		expect(called).toBe(false);
	});

	test('stub path inserts a compose row and no env values', async () => {
		const inserted: unknown[] = [];
		const pack = (await import('../../src/lib/server/ai/evidence')).buildEvidencePack({
			app: app(),
			deploy: deploy()
		});
		expect(pack.ok).toBe(true);
		if (!pack.ok) return;
		const payload = stubExplain(pack.pack);

		const result = await explainDeploy(app(), deploy(), {
			extras: noExtras,
			callModel: async (p) => {
				expect(JSON.stringify(p)).not.toContain(secret);
				return { payload: stubExplain(p), model: 'stub', raw: null };
			},
			persist: async (row) => {
				inserted.push(row);
				expect(JSON.stringify(row)).not.toContain(secret);
				return saved({
					causeClass: row.causeClass,
					summary: row.summary,
					evidence: row.evidence as string[],
					nextChecks: row.nextChecks as string[],
					model: row.model
				});
			}
		});
		expect(result.ok).toBe(true);
		expect(inserted).toHaveLength(1);
		expect(payload.cause_class).toBe('compose');
		if (!result.ok) return;
		expect(result.explanation.causeClass).toBe('compose');
		expect(result.explanation.model).toBe('stub');
	});

	test('Ollama unreachable does not insert a row', async () => {
		let inserted = 0;
		const result = await explainDeploy(app(), deploy(), {
			extras: noExtras,
			callModel: async () => {
				throw new ProviderError('Ollama is not reachable at http://127.0.0.1:11434/v1', 502);
			},
			persist: async () => {
				inserted += 1;
				return saved();
			}
		});
		expect(result).toEqual({
			ok: false,
			error: 'Ollama is not reachable at http://127.0.0.1:11434/v1',
			status: 502
		});
		expect(inserted).toBe(0);
	});
});

describe('coerceExplanation', () => {
	test('wraps unusable model text as unknown', () => {
		const payload = coerceExplanation('not json at all');
		expect(payload.cause_class).toBe('unknown');
		expect(payload.summary).toContain('not json');
	});
});
