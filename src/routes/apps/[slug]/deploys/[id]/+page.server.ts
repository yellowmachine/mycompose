import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apps, deploys } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) error(404, 'App not found');

	const [deploy] = await db
		.select()
		.from(deploys)
		.where(and(eq(deploys.id, params.id), eq(deploys.appId, app.id)))
		.limit(1);
	if (!deploy) error(404, 'Deploy not found');

	return { app, deploy };
};
