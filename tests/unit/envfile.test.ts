import { describe, expect, test } from 'vitest';
import { encodeEnvValue, serializeEnvFile } from '../../src/lib/server/envfile';

describe('envfile', () => {
	test('simple values are unquoted', () => {
		expect(encodeEnvValue('abc_123')).toBe('abc_123');
	});

	test('quotes values with spaces and escapes single quotes', () => {
		expect(encodeEnvValue("it's a secret")).toBe(`'it'\\''s a secret'`);
	});

	test('serializes key=value lines with a trailing newline', () => {
		expect(serializeEnvFile({ FOO: 'bar', BAZ: 'qux' })).toBe('FOO=bar\nBAZ=qux\n');
	});

	test('empty snapshot is an empty file', () => {
		expect(serializeEnvFile({})).toBe('');
	});
});
