import { describe, expect, test } from 'vitest';
import { composeArgv, composeProjectName } from '../../src/lib/server/compose';

const base = {
	slug: 'sample',
	repoRoot: '/data/apps/sample/repo',
	composePath: 'docker-compose.yml',
	envFile: '/data/apps/sample/deploy.env'
};

describe('compose argv', () => {
	test('project name is namespaced', () => {
		expect(composeProjectName('sample')).toBe('mycompose-sample');
	});

	test('up uses build and detach', () => {
		const argv = composeArgv({ ...base, command: 'up' });
		expect(argv).toEqual([
			'compose',
			'-p',
			'mycompose-sample',
			'--project-directory',
			base.repoRoot,
			'-f',
			'docker-compose.yml',
			'--env-file',
			base.envFile,
			'up',
			'-d',
			'--build'
		]);
	});

	test('down never includes -v', () => {
		const argv = composeArgv({ ...base, command: 'down' });
		expect(argv).not.toContain('-v');
		expect(argv).not.toContain('--volumes');
		expect(argv.at(-1)).toBe('down');
	});

	test('down rejects volume flags in extra', () => {
		expect(() => composeArgv({ ...base, command: 'down', extra: ['-v'] })).toThrow(
			/volume removal/i
		);
	});
});
