import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vitest/config';
import adapter from 'svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const g = globalThis as typeof globalThis & { __mycomposeWsDev?: ChildProcess };

function wsDevPlugin(): Plugin {
	return {
		name: 'mycompose-ws-dev',
		apply: 'serve',
		configureServer(server) {
			if (process.env.VITEST || process.env.MYCOMPOSE_WS_DEV === '0') return;
			if (g.__mycomposeWsDev && g.__mycomposeWsDev.exitCode === null) return;
			const child = spawn('bun', [path.resolve(dirname, 'scripts/ws-dev.ts')], {
				stdio: ['ignore', 'inherit', 'inherit'],
				env: { ...process.env }
			});
			g.__mycomposeWsDev = child;
			const stop = () => {
				child.kill();
				if (g.__mycomposeWsDev === child) g.__mycomposeWsDev = undefined;
			};
			server.httpServer?.once('close', stop);
		}
	};
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		wsDevPlugin(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	],
	server: {
		proxy: {
			'/ws': {
				target: 'http://127.0.0.1:5174',
				ws: true
			}
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.test.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				},
				resolve: {
					alias: {
						$lib: path.resolve(dirname, 'src/lib')
					}
				}
			}
		]
	}
});
