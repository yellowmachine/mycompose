import { expect, test } from '@playwright/test';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P6 runtime', () => {
	test('shows ports and metrics while running, not after stop', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `rt${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Runtime');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');

			await expect(page.getByTestId('published-ports')).toContainText(':18080', {
				timeout: 15_000
			});
			await expect(page.getByTestId('runtime-row')).toContainText('web');
			await expect(page.getByTestId('runtime-row')).toContainText('running');
			await expect(
				page.getByTestId('cpu').or(page.getByTestId('stats-unavailable')).first()
			).toBeVisible({ timeout: 10_000 });

			await page.getByRole('button', { name: 'Stop' }).click();
			await waitForAppStatus(page, 'stopped');
			await expect(page.getByTestId('cpu')).toHaveCount(0);
			await expect(page.getByTestId('memory')).toHaveCount(0);
			await expect(page.getByTestId('published-ports')).toHaveCount(0);
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
