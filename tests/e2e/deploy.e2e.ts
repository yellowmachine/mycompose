import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P1 deploy', () => {
	test('deploys a public-style local compose repo', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `sample${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Sample');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await expect(page).toHaveURL(new RegExp(`/apps/${slug}$`));

			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');
			await expect(page.getByText(/live [0-9a-f]{7}/)).toBeVisible();

			const ps = execSync(`docker compose -p mycompose-${slug} ps --format json`, {
				encoding: 'utf8'
			});
			expect(ps).toContain('running');
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});

	test('failed clone does not mark the app running', async ({ page }) => {
		const slug = `badurl${Date.now().toString(36)}`;
		await page.goto('/apps/new');
		await page.locator('input[name="name"]').fill('Bad URL');
		await page.locator('input[name="slug"]').fill(slug);
		await page
			.locator('input[name="gitUrl"]')
			.fill('https://github.com/this-org-does-not-exist-mycompose/nope.git');
		await page.getByRole('button', { name: 'Create' }).click();
		await page.getByRole('button', { name: 'Deploy' }).click();
		await waitForAppStatus(page, 'failed');
		await page.getByRole('link', { name: 'view' }).first().click();
		await expect(page.locator('pre')).toContainText(/ERROR/i);
	});

	test('missing compose path fails with the path in the log', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `nopath${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Missing compose');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.locator('input[name="composePath"]').fill('does-not-exist.yml');
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'failed');
			await page.getByRole('link', { name: 'view' }).first().click();
			await expect(page.locator('pre')).toContainText('does-not-exist.yml');
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});

	test('invalid compose file fails', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/invalid-compose'));
		const slug = `invalid${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Invalid compose');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'failed');
			await page.getByRole('link', { name: 'view' }).first().click();
			await expect(page.locator('pre')).toContainText(/ERROR/i);
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
