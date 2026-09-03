import { defineConfig } from '@playwright/test';

const databaseUrl =
	process.env.DATABASE_URL ?? 'postgres://mycompose:mycompose@localhost:5433/mycompose';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	timeout: 180_000,
	webServer: {
		command: 'bun --bun vite dev --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...process.env,
			DATABASE_URL: databaseUrl,
			MYCOMPOSE_ALLOW_LOCAL_GIT: '1',
			MYCOMPOSE_DATA_DIR: 'data-e2e'
		}
	},
	use: {
		baseURL: 'http://localhost:4173'
	}
});
