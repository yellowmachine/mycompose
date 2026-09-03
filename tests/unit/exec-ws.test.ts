import { describe, expect, test } from 'vitest';
import { parseExecPath, parseResizeMessage, pickShell } from '../../src/lib/server/exec-ws';

describe('parseExecPath', () => {
	test('parses slug and service', () => {
		expect(parseExecPath('/ws/apps/sample/services/web/exec')).toEqual({
			slug: 'sample',
			service: 'web'
		});
	});

	test('rejects bad paths', () => {
		expect(parseExecPath('/ws/apps/sample/exec')).toBeNull();
		expect(parseExecPath('/ws/apps/SAMPLE/services/web/exec')).toBeNull();
		expect(parseExecPath('/ws/apps/sample/services/web;id/exec')).toBeNull();
	});
});

describe('parseResizeMessage', () => {
	test('reads resize JSON', () => {
		expect(parseResizeMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
			cols: 120,
			rows: 40
		});
	});

	test('ignores stdin that is not resize JSON', () => {
		expect(parseResizeMessage('pwd\n')).toBeNull();
		expect(parseResizeMessage('{not json')).toBeNull();
	});
});

describe('pickShell', () => {
	test('prefers /bin/sh', async () => {
		expect(await pickShell(async (cmd) => cmd === '/bin/sh')).toBe('/bin/sh');
	});

	test('falls back to bash', async () => {
		expect(await pickShell(async (cmd) => cmd === '/bin/bash')).toBe('/bin/bash');
	});

	test('errors when neither shell exists', async () => {
		await expect(pickShell(async () => false)).rejects.toThrow(/No shell in this image/);
	});
});
