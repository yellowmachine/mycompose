import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P4 deploy history', () => {
	test('live SHA stays on last success after a failed deploy', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `hist${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('History');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();

			await page.getByRole('button', { name: 'Deploy' }).click();
			await expect(page.getByRole('button', { name: 'Deploying…' })).toBeDisabled();
			await waitForAppStatus(page, 'running');

			const liveSha = await page.getByTestId('live-sha').getAttribute('title');
			expect(liveSha).toMatch(/^[0-9a-f]{40}$/);

			execSync(
				'echo extra >> docker-compose.yml && git add docker-compose.yml && git -c user.email=t@t.com -c user.name=t commit -m extra',
				{ cwd: repo }
			);

			await page.locator('input[name="composePath"]').fill('does-not-exist.yml');
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(page.getByText('Saved.')).toBeVisible();

			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'failed');

			await expect(page.getByText('succeeded', { exact: true })).toBeVisible();
			await expect(page.getByText('failed', { exact: true }).first()).toBeVisible();
			expect(await page.getByRole('link', { name: 'view' }).count()).toBe(2);
			await expect(page.getByTestId('live-sha')).toHaveAttribute('title', liveSha as string);
			await expect(page.getByTestId('live-sha')).toContainText(`live ${liveSha?.slice(0, 7)}`);
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
