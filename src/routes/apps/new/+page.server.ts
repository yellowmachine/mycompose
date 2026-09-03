import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { isUniqueViolation } from '$lib/server/db/errors';
import { apps } from '$lib/server/db/schema';
import { allowLocalGit } from '$lib/server/config';
import { createAppSchema, parseGitUrl, slugify, validateComposePath } from '$lib/server/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { allowLocalGit: allowLocalGit() };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		let slug = String(form.get('slug') ?? '').trim();
		if (!slug) slug = slugify(name);

		const parsed = createAppSchema.safeParse({
			name,
			slug,
			gitUrl: String(form.get('gitUrl') ?? ''),
			branch: String(form.get('branch') ?? 'main') || 'main',
			composePath: String(form.get('composePath') ?? 'docker-compose.yml') || 'docker-compose.yml'
		});

		const values = {
			name,
			slug,
			gitUrl: String(form.get('gitUrl') ?? ''),
			branch: String(form.get('branch') ?? 'main'),
			composePath: String(form.get('composePath') ?? 'docker-compose.yml')
		};

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Invalid input',
				values
			});
		}

		const git = parseGitUrl(parsed.data.gitUrl, allowLocalGit());
		if (!git.ok) return fail(400, { error: git.error, values });

		const compose = validateComposePath(parsed.data.composePath);
		if (!compose.ok) return fail(400, { error: compose.error, values });

		try {
			await db.insert(apps).values({
				name: parsed.data.name,
				slug: parsed.data.slug,
				gitUrl: git.url,
				branch: parsed.data.branch,
				composePath: compose.path
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				return fail(400, { error: 'An app with this slug already exists', values });
			}
			throw error;
		}

		redirect(303, `/apps/${parsed.data.slug}`);
	}
};
