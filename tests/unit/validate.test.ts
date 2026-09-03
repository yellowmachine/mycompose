import { describe, expect, test } from 'vitest';
import {
	parseGitUrl,
	slugify,
	slugSchema,
	validateComposePath,
	envKeySchema,
	parseEnvRows
} from '../../src/lib/server/validate';

describe('slug', () => {
	test('accepts a single letter', () => {
		expect(slugSchema.safeParse('a').success).toBe(true);
	});

	test('rejects uppercase and leading hyphen', () => {
		expect(slugSchema.safeParse('Foo').success).toBe(false);
		expect(slugSchema.safeParse('-foo').success).toBe(false);
		expect(slugSchema.safeParse('foo-').success).toBe(false);
	});

	test('slugify produces a valid slug from a name', () => {
		const slug = slugify('Hello World');
		expect(slug).toBe('hello-world');
		expect(slugSchema.safeParse(slug).success).toBe(true);
	});
});

describe('parseGitUrl', () => {
	test('accepts public https URLs', () => {
		const r = parseGitUrl('https://github.com/org/repo.git', false);
		expect(r.ok).toBe(true);
	});

	test('rejects ssh and credentials', () => {
		expect(parseGitUrl('git@github.com:org/repo.git', false).ok).toBe(false);
		expect(parseGitUrl('https://user:pass@github.com/org/repo.git', false).ok).toBe(false);
		expect(parseGitUrl('http://github.com/org/repo.git', false).ok).toBe(false);
	});

	test('allows local paths only when flagged', () => {
		expect(parseGitUrl('/tmp/repo.git', false).ok).toBe(false);
		expect(parseGitUrl('/tmp/repo.git', true).ok).toBe(true);
		expect(parseGitUrl('file:///tmp/repo.git', true).ok).toBe(true);
	});
});

describe('compose path', () => {
	test('rejects absolute and parent segments', () => {
		expect(validateComposePath('/etc/passwd').ok).toBe(false);
		expect(validateComposePath('../docker-compose.yml').ok).toBe(false);
		expect(validateComposePath('foo/../../x.yml').ok).toBe(false);
	});

	test('accepts nested relative paths', () => {
		const r = validateComposePath('deploy/compose.yaml');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.path).toBe('deploy/compose.yaml');
	});
});

describe('env keys', () => {
	test('accepts typical keys', () => {
		expect(envKeySchema.safeParse('POSTGRES_PASSWORD').success).toBe(true);
		expect(envKeySchema.safeParse('_FOO').success).toBe(true);
	});

	test('rejects empty and invalid keys', () => {
		expect(envKeySchema.safeParse('').success).toBe(false);
		expect(envKeySchema.safeParse('1FOO').success).toBe(false);
		expect(envKeySchema.safeParse('FOO-BAR').success).toBe(false);
	});
});

describe('parseEnvRows', () => {
	test('allows empty values and skips blank rows', () => {
		const r = parseEnvRows(['FOO', '', 'BAR'], ['', '', 'x']);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.rows).toEqual([
				{ key: 'FOO', value: '' },
				{ key: 'BAR', value: 'x' }
			]);
		}
	});

	test('rejects duplicate keys', () => {
		const r = parseEnvRows(['FOO', 'FOO'], ['a', 'b']);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/duplicate/i);
	});

	test('rejects a value without a key', () => {
		const r = parseEnvRows([''], ['secret']);
		expect(r.ok).toBe(false);
	});
});
