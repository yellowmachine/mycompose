import { describe, expect, test } from 'vitest';
import { LOG_CAP, appendLog } from '../../src/lib/server/log';

describe('appendLog', () => {
	test('concatenates under the cap', () => {
		expect(appendLog('a', 'b', false)).toEqual({ text: 'ab', truncated: false });
	});

	test('stops appending once truncated', () => {
		expect(appendLog('kept', 'more', true)).toEqual({ text: 'kept', truncated: true });
	});

	test('truncates at the cap and marks it', () => {
		const current = 'x'.repeat(LOG_CAP - 2);
		const next = appendLog(current, 'abcdef', false);
		expect(next.truncated).toBe(true);
		expect(next.text.endsWith('[log truncated]\n')).toBe(true);
		expect(next.text.length).toBeGreaterThan(LOG_CAP - 2);
		expect(next.text.startsWith(current)).toBe(true);
	});
});
