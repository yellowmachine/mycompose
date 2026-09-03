import { expect, test } from '@playwright/test';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('P7 terminal', () => {
	test('runs pwd in a running service and disables when stopped', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `term${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Terminal');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');
			await expect(page.getByTestId('runtime-row')).toContainText('web', { timeout: 15_000 });

			await page.getByTestId('open-terminal').click();
			await expect(page.getByTestId('terminal')).toHaveAttribute('data-connected', 'true', {
				timeout: 15_000
			});
			await expect(page.getByTestId('terminal')).toContainText('#', { timeout: 15_000 });

			await page.locator('.xterm-helper-textarea').click();
			await page.keyboard.type('pwd');
			await page.keyboard.press('Enter');
			await expect(page.getByTestId('terminal')).toContainText('/', { timeout: 15_000 });

			await page.getByRole('button', { name: 'Stop' }).click();
			await waitForAppStatus(page, 'stopped');
			await expect(page.getByTestId('open-terminal')).toBeDisabled();
			await expect(page.getByText('Service is not running')).toBeVisible();
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
