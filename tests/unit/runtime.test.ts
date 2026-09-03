import { describe, expect, test } from 'vitest';
import { dedupeRuntimePorts, uniqueHostPorts } from '../../src/lib/runtime';

describe('dedupeRuntimePorts', () => {
	test('drops ipv4/ipv6 duplicates of the same mapping', () => {
		expect(
			dedupeRuntimePorts([
				{ host: 18080, container: 80, protocol: 'tcp' },
				{ host: 18080, container: 80, protocol: 'tcp' }
			])
		).toEqual([{ host: 18080, container: 80, protocol: 'tcp' }]);
	});

	test('keeps distinct host ports', () => {
		expect(
			dedupeRuntimePorts([
				{ host: 18080, container: 80, protocol: 'tcp' },
				{ host: 18081, container: 80, protocol: 'tcp' }
			])
		).toHaveLength(2);
	});
});

describe('uniqueHostPorts', () => {
	test('lists each host port once', () => {
		expect(
			uniqueHostPorts([
				{
					name: 'web',
					state: 'running',
					cpuPercent: 1,
					memoryBytes: 1,
					memoryLimitBytes: 2,
					statsUnavailable: false,
					ports: [
						{ host: 18080, container: 80, protocol: 'tcp' },
						{ host: 18080, container: 80, protocol: 'tcp' }
					]
				}
			])
		).toEqual([18080]);
	});
});
