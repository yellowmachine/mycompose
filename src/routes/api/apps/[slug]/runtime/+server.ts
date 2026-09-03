import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apps } from '$lib/server/db/schema';
import { projectRuntime } from '$lib/server/docker';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) error(404, 'App not found');
	const runtime = await projectRuntime(app.slug);
	return json(runtime);
};
