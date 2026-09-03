import { expect, test } from '@playwright/test';
import path from 'node:path';
import { composePsJson, downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

test.describe('A1 explain', () => {
	test('stub explains invalid compose without changing the stack or log', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/invalid-compose'));
		const slug = `expl${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Explain');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'failed');
			await page.getByRole('link', { name: 'view' }).first().click();

			const logBefore = await page.getByTestId('log-viewer').textContent();
			expect(logBefore ?? '').toMatch(/ERROR|yaml|compose/i);
			const psBefore = composePsJson(slug);

			await page.getByTestId('explain').click();
			await expect(page.getByTestId('explanation')).toHaveCount(1, { timeout: 15_000 });
			await expect(page.getByTestId('explanation').first()).toContainText(/compose/i);

			await page.getByTestId('explain').click();
			await expect(page.getByTestId('explanation')).toHaveCount(2, { timeout: 15_000 });
			await expect(page.getByTestId('log-viewer')).toContainText(logBefore ?? '');
			expect(composePsJson(slug)).toBe(psBefore);
		} finally {
			downProject(slug);
			await removeRepo(repo);
		}
	});
});
