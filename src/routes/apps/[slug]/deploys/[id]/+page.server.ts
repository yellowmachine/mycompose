import { error, fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { evidenceFromRows, explainDeploy } from '$lib/server/ai/explain';
import { db } from '$lib/server/db';
import { apps, deployExplanations, deploys } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) error(404, 'App not found');

	const [deploy] = await db
		.select()
		.from(deploys)
		.where(and(eq(deploys.id, params.id), eq(deploys.appId, app.id)))
		.limit(1);
	if (!deploy) error(404, 'Deploy not found');

	const explanations = await db
		.select()
		.from(deployExplanations)
		.where(eq(deployExplanations.deployId, deploy.id))
		.orderBy(desc(deployExplanations.createdAt));

	return { app, deploy, explanations };
};

export const actions: Actions = {
	explain: async ({ params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });

		const [deploy] = await db
			.select()
			.from(deploys)
			.where(and(eq(deploys.id, params.id), eq(deploys.appId, app.id)))
			.limit(1);
		if (!deploy) return fail(404, { error: 'Deploy not found' });

		const input = evidenceFromRows(app, deploy);
		const result = await explainDeploy(input.app, input.deploy);
		if (!result.ok) return fail(result.status, { error: result.error });
		return { explained: true };
	}
};
