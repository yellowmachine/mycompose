import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { downProject, makeGitRepo, removeRepo, waitForAppStatus } from './helpers';

function runningIds(slug: string): string {
	return execSync(`docker ps -q -f label=com.docker.compose.project=mycompose-${slug}`, {
		encoding: 'utf8'
	}).trim();
}

function allIds(slug: string): string {
	return execSync(`docker ps -aq -f label=com.docker.compose.project=mycompose-${slug}`, {
		encoding: 'utf8'
	}).trim();
}

function volumeName(slug: string): string {
	return `mycompose-${slug}_sample_data`;
}

function writeMarker(slug: string) {
	const id = runningIds(slug).split('\n')[0];
	if (!id) throw new Error('no running container');
	execSync(`docker exec ${id} sh -c 'echo surviving > /usr/share/nginx/html/data/marker'`);
}

function readMarkerFromVolume(slug: string): string {
	return execSync(`docker run --rm -v ${volumeName(slug)}:/v busybox:1.36 cat /v/marker`, {
		encoding: 'utf8'
	}).trim();
}

function volumeExists(slug: string): boolean {
	try {
		execSync(`docker volume inspect ${volumeName(slug)}`, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

test.describe('P3 lifecycle', () => {
	test('stop start keeps volume data; destroy keeps the volume', async ({ page }) => {
		const repo = await makeGitRepo(path.resolve('fixtures/sample-compose'));
		const slug = `life${Date.now().toString(36)}`;
		try {
			await page.goto('/apps/new');
			await page.locator('input[name="name"]').fill('Lifecycle');
			await page.locator('input[name="slug"]').fill(slug);
			await page.locator('input[name="gitUrl"]').fill(repo);
			await page.getByRole('button', { name: 'Create' }).click();
			await page.getByRole('button', { name: 'Deploy' }).click();
			await waitForAppStatus(page, 'running');

			writeMarker(slug);
			const rowsBefore = await page.getByRole('row').count();

			await page.getByRole('button', { name: 'Stop' }).click();
			await waitForAppStatus(page, 'stopped');
			expect(runningIds(slug)).toBe('');

			await page.getByRole('button', { name: 'Start' }).click();
			await waitForAppStatus(page, 'running');
			expect(readMarkerFromVolume(slug)).toBe('surviving');
			expect(await page.getByRole('row').count()).toBe(rowsBefore);

			await page.locator('input[name="confirm"]').fill('wrong');
			await page.getByRole('button', { name: 'Destroy' }).click();
			await expect(page.getByText('Type the slug to confirm destroy')).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`/apps/${slug}`));

			await page.locator('input[name="confirm"]').fill(slug);
			await page.getByRole('button', { name: 'Destroy' }).click();
			await expect(page).toHaveURL(/\/$/);
			await expect(page.getByText(slug)).toHaveCount(0);

			expect(allIds(slug)).toBe('');
			expect(volumeExists(slug)).toBe(true);
			expect(readMarkerFromVolume(slug)).toBe('surviving');
		} finally {
			downProject(slug);
			try {
				execSync(`docker volume rm ${volumeName(slug)}`, { stdio: 'ignore' });
			} catch {
				// already gone
			}
			await removeRepo(repo);
		}
	});
});
