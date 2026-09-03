import { describe, expect, test } from 'vitest';
import { cpuPercent, memoryLimitBytes, memoryUsageBytes } from '../../src/lib/server/docker-stats';

describe('cpuPercent', () => {
	test('returns null when deltas are missing', () => {
		expect(cpuPercent({})).toBeNull();
		expect(cpuPercent({ cpu_stats: { cpu_usage: { total_usage: 10 } } })).toBeNull();
	});

	test('computes percent from deltas', () => {
		const pct = cpuPercent({
			cpu_stats: {
				cpu_usage: { total_usage: 200, percpu_usage: [1, 1] },
				system_cpu_usage: 1000,
				online_cpus: 2
			},
			precpu_stats: {
				cpu_usage: { total_usage: 100 },
				system_cpu_usage: 500
			}
		});
		expect(pct).toBe(40);
	});
});

describe('memory', () => {
	test('returns null when usage is missing', () => {
		expect(memoryUsageBytes({})).toBeNull();
		expect(memoryLimitBytes({})).toBeNull();
	});

	test('subtracts cache when present', () => {
		expect(memoryUsageBytes({ memory_stats: { usage: 1000, stats: { cache: 200 } } })).toBe(800);
	});
});
