import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apps } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db.select().from(apps).orderBy(desc(apps.updatedAt));
	return { apps: rows };
};
