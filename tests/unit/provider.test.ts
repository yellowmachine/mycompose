import { afterEach, describe, expect, test } from 'vitest';
import {
	buildEvidencePack,
	type EvidenceApp,
	type EvidenceDeploy
} from '../../src/lib/server/ai/evidence';
import { explainDeploy } from '../../src/lib/server/ai/explain';
import { explainWithOllama, ProviderError } from '../../src/lib/server/ai/provider';

function pack() {
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
		errorSummary: 'invalid compose',
		startedAt: new Date('2026-09-03T12:00:00.000Z'),
		finishedAt: new Date('2026-09-03T12:00:01.000Z'),
		logText: 'yaml: line 1: did not find expected key',
		logTruncated: false,
		envSnapshot: {}
	};
	const result = buildEvidencePack({ app, deploy });
	if (!result.ok) throw new Error(result.error);
	return { app, deploy, pack: result.pack };
}

afterEach(() => {
	delete process.env.OLLAMA_BASE_URL;
	delete process.env.MYCOMPOSE_AI_STUB;
});

describe('explainWithOllama', () => {
	test('throws 502 when Ollama is down', async () => {
		process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9/v1';
		await expect(explainWithOllama(pack().pack)).rejects.toMatchObject({
			name: 'ProviderError',
			status: 502
		} satisfies Partial<ProviderError>);
	});
});

describe('explainDeploy live wiring', () => {
	test('stub off and Ollama down does not insert', async () => {
		process.env.MYCOMPOSE_AI_STUB = '0';
		process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9/v1';
		const { app, deploy } = pack();
		let inserted = 0;
		const result = await explainDeploy(app, deploy, {
			extras: async () => ({ composeExcerpt: null, runtime: null, containerLogs: null }),
			persist: async () => {
				inserted += 1;
				throw new Error('should not insert');
			}
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(502);
		expect(result.error).toMatch(/Ollama is not reachable/);
		expect(inserted).toBe(0);
	});
});
