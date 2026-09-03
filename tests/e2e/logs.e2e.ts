import { expect, test } from '@playwright/test';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P5 logs', () => {
	test('deploy log streams and container logs hide when stopped', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `logs${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Logs');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');

			await page.getByRole('link', { name: 'view' }).first().click();
			await expect(page.getByTestId('log-viewer')).toContainText(
				/Cloning|Commit|compose|Deploy succeeded/i,
				{ timeout: 20_000 }
			);

			await page.getByRole('link', { name: '← Logs' }).click();
			await expect(page.getByTestId('log-viewer')).toContainText(
				/nginx|start worker|Listening|web-/i,
				{
					timeout: 20_000
				}
			);

			await page.getByRole('button', { name: 'Stop' }).click();
			await waitForAppStatus(page, 'stopped');
			await expect(page.getByTestId('container-logs-empty')).toBeVisible();

			await page.getByRole('link', { name: 'view' }).first().click();
			await expect(page.getByTestId('log-viewer')).toContainText(
				/Cloning|Commit|Deploy succeeded/i
			);
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
