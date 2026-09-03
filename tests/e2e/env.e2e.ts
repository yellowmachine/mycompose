import { expect, test } from '@playwright/test';
import path from 'node:path';
import { containerEnv, downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P2 environment', () => {
	test('env is applied on deploy and not before', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/env-compose'));
		const slug = `env${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Env app');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await expect(page).toHaveURL(new RegExp(`/apps/${slug}$`));

			await page.locator('input[name="key"]').first().fill('FOO');
			await page.locator('input[name="value"]').first().fill('first');
			await page.getByRole('button', { name: 'Save environment' }).click();
			await expect(page.getByText('Environment saved')).toBeVisible();

			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');
			expect(containerEnv(slug, 'FOO')).toBe('first');

			await page.locator('input[name="value"]').first().fill('second');
			await page.getByRole('button', { name: 'Save environment' }).click();
			await expect(page.getByText('Environment saved')).toBeVisible();
			expect(containerEnv(slug, 'FOO')).toBe('first');

			await page.getByRole('link', { name: 'view' }).first().click();
			await expect(page.getByText('FOO')).toBeVisible();
			await expect(page.getByText('first')).toBeVisible();
			await expect(page.getByText('second')).toHaveCount(0);

			await page.getByRole('link', { name: `← Env app` }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');
			expect(containerEnv(slug, 'FOO')).toBe('second');
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
