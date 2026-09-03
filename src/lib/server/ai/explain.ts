import { apps, deployExplanations, deploys } from '../db/schema';
import {
	buildEvidencePack,
	gatherEvidenceExtras,
	type EvidenceApp,
	type EvidenceDeploy,
	type EvidencePack
} from './evidence';
import { explainWithOllama, ProviderError, type ModelResult } from './provider';
import { aiStubEnabled, stubExplain, STUB_MODEL } from './stub';

export type ExplainStatus = 400 | 502 | 504;

export type ExplainResult =
	{ ok: true; explanation: ExplanationRow } | { ok: false; error: string; status: ExplainStatus };

export type ExplanationRow = typeof deployExplanations.$inferSelect;

type AppRow = typeof apps.$inferSelect;
type DeployRow = typeof deploys.$inferSelect;

export function evidenceFromRows(
	app: AppRow,
	deploy: DeployRow
): {
	app: EvidenceApp;
	deploy: EvidenceDeploy;
} {
	return {
		app: {
			name: app.name,
			slug: app.slug,
			gitUrl: app.gitUrl,
			branch: app.branch,
			composePath: app.composePath,
			status: app.status,
			liveSha: app.liveSha
		},
		deploy: {
			id: deploy.id,
			sha: deploy.sha,
			branch: deploy.branch,
			composePath: deploy.composePath,
			status: deploy.status,
			errorSummary: deploy.errorSummary,
			startedAt: deploy.startedAt,
			finishedAt: deploy.finishedAt,
			logText: deploy.logText,
			logTruncated: deploy.logTruncated,
			envSnapshot: deploy.envSnapshot
		}
	};
}

export type PersistExplanation = (
	row: typeof deployExplanations.$inferInsert
) => Promise<ExplanationRow>;

export type ExplainDeps = {
	extras?: typeof gatherEvidenceExtras;
	callModel?: (pack: EvidencePack) => Promise<ModelResult>;
	persist?: PersistExplanation;
};

async function defaultPersist(
	row: typeof deployExplanations.$inferInsert
): Promise<ExplanationRow> {
	const { db } = await import('../db');
	const [saved] = await db.insert(deployExplanations).values(row).returning();
	if (!saved) throw new Error('Failed to store explanation');
	return saved;
}

async function defaultCallModel(pack: EvidencePack): Promise<ModelResult> {
	if (aiStubEnabled()) {
		return { payload: stubExplain(pack), model: STUB_MODEL, raw: null };
	}
	return explainWithOllama(pack);
}

export async function explainDeploy(
	app: EvidenceApp,
	deploy: EvidenceDeploy,
	deps: ExplainDeps = {}
): Promise<ExplainResult> {
	const early = buildEvidencePack({ app, deploy });
	if (!early.ok) {
		return { ok: false, error: early.error, status: 400 };
	}

	const extras = await (deps.extras ?? gatherEvidenceExtras)(app.slug, deploy.composePath);
	const packed = buildEvidencePack({
		app,
		deploy,
		composeExcerpt: extras.composeExcerpt,
		runtime: extras.runtime,
		containerLogs: extras.containerLogs
	});
	if (!packed.ok) {
		return { ok: false, error: packed.error, status: 400 };
	}

	let result: ModelResult;
	try {
		result = await (deps.callModel ?? defaultCallModel)(packed.pack);
	} catch (error) {
		if (error instanceof ProviderError) {
			return { ok: false, error: error.message, status: error.status };
		}
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Explain failed',
			status: 502
		};
	}

	const persist = deps.persist ?? defaultPersist;
	const explanation = await persist({
		deployId: deploy.id,
		causeClass: result.payload.cause_class,
		summary: result.payload.summary,
		evidence: result.payload.evidence,
		nextChecks: result.payload.next_checks,
		confidence: result.payload.confidence,
		model: result.model,
		raw: result.raw
	});

	return { ok: true, explanation };
}
