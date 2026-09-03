import { fail, redirect } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { allowLocalGit } from '$lib/server/config';
import { db } from '$lib/server/db';
import { isUniqueViolation } from '$lib/server/db/errors';
import { appEnvVars, apps, deploys } from '$lib/server/db/schema';
import { enqueue } from '$lib/server/jobs/queue';
import { runDeploy } from '$lib/server/jobs/deploy';
import { destroyStack, startStack, stopStack } from '$lib/server/lifecycle';
import {
	parseEnvRows,
	parseGitUrl,
	updateAppSchema,
	validateComposePath
} from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) {
		redirect(303, '/');
	}
	const history = await db
		.select()
		.from(deploys)
		.where(eq(deploys.appId, app.id))
		.orderBy(desc(deploys.startedAt));
	const envVars = await db
		.select()
		.from(appEnvVars)
		.where(eq(appEnvVars.appId, app.id))
		.orderBy(asc(appEnvVars.key));
	return { app, deploys: history, envVars };
};

export const actions: Actions = {
	update: async ({ request, params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });

		const form = await request.formData();
		const parsed = updateAppSchema.safeParse({
			name: String(form.get('name') ?? ''),
			gitUrl: String(form.get('gitUrl') ?? ''),
			branch: String(form.get('branch') ?? ''),
			composePath: String(form.get('composePath') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' });
		}
		const git = parseGitUrl(parsed.data.gitUrl, allowLocalGit());
		if (!git.ok) return fail(400, { error: git.error });
		const compose = validateComposePath(parsed.data.composePath);
		if (!compose.ok) return fail(400, { error: compose.error });

		await db
			.update(apps)
			.set({
				name: parsed.data.name,
				gitUrl: git.url,
				branch: parsed.data.branch,
				composePath: compose.path,
				updatedAt: new Date()
			})
			.where(eq(apps.id, app.id));
		return { saved: true };
	},

	deploy: async ({ params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });

		try {
			const [deploy] = await db
				.insert(deploys)
				.values({
					appId: app.id,
					gitUrl: app.gitUrl,
					branch: app.branch,
					composePath: app.composePath,
					envSnapshot: {},
					status: 'pending'
				})
				.returning();

			await db
				.update(apps)
				.set({ status: 'deploying', updatedAt: new Date() })
				.where(eq(apps.id, app.id));

			enqueue(app.id, (signal) => runDeploy(deploy.id, signal));
			return { queued: true, deployId: deploy.id };
		} catch (error) {
			if (isUniqueViolation(error, 'deploys_inflight_uidx') || isUniqueViolation(error)) {
				return fail(409, { error: 'A deploy is already in progress' });
			}
			throw error;
		}
	},

	saveEnv: async ({ request, params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });

		const form = await request.formData();
		const parsed = parseEnvRows(
			form.getAll('key').map((v) => String(v)),
			form.getAll('value').map((v) => String(v))
		);
		if (!parsed.ok) return fail(400, { error: parsed.error });

		await db.transaction(async (tx) => {
			await tx.delete(appEnvVars).where(eq(appEnvVars.appId, app.id));
			if (parsed.rows.length > 0) {
				await tx.insert(appEnvVars).values(
					parsed.rows.map((row) => ({
						appId: app.id,
						key: row.key,
						value: row.value
					}))
				);
			}
			await tx.update(apps).set({ updatedAt: new Date() }).where(eq(apps.id, app.id));
		});

		return { envSaved: true };
	},

	stop: async ({ params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });
		if (app.status !== 'running') return fail(400, { error: 'App is not running' });
		try {
			await stopStack(app);
		} catch (error) {
			return fail(500, {
				error: error instanceof Error ? error.message : 'Stop failed'
			});
		}
		return { stopped: true };
	},

	start: async ({ params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });
		if (app.status !== 'stopped') return fail(400, { error: 'App is not stopped' });
		try {
			await startStack(app);
		} catch (error) {
			return fail(500, {
				error: error instanceof Error ? error.message : 'Start failed'
			});
		}
		return { started: true };
	},

	destroy: async ({ request, params }) => {
		const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
		if (!app) return fail(404, { error: 'App not found' });
		const form = await request.formData();
		const confirm = String(form.get('confirm') ?? '').trim();
		if (confirm !== app.slug) {
			return fail(400, { error: 'Type the slug to confirm destroy' });
		}
		try {
			await destroyStack(app);
		} catch (error) {
			return fail(500, {
				error: error instanceof Error ? error.message : 'Destroy failed'
			});
		}
		redirect(303, '/');
	}
};
