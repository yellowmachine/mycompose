export type CpuStatsInput = {
	cpu_stats?: {
		cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
		system_cpu_usage?: number;
		online_cpus?: number;
	};
	precpu_stats?: {
		cpu_usage?: { total_usage?: number };
		system_cpu_usage?: number;
	};
};

export type MemoryStatsInput = {
	memory_stats?: {
		usage?: number;
		limit?: number;
		stats?: { cache?: number };
	};
};

export function cpuPercent(stats: CpuStatsInput): number | null {
	const total = stats.cpu_stats?.cpu_usage?.total_usage;
	const preTotal = stats.precpu_stats?.cpu_usage?.total_usage;
	const system = stats.cpu_stats?.system_cpu_usage;
	const preSystem = stats.precpu_stats?.system_cpu_usage;
	if (
		total === undefined ||
		preTotal === undefined ||
		system === undefined ||
		preSystem === undefined
	) {
		return null;
	}
	const cpuDelta = total - preTotal;
	const systemDelta = system - preSystem;
	if (cpuDelta < 0 || systemDelta <= 0) return null;
	const ncpu =
		stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
	return (cpuDelta / systemDelta) * ncpu * 100;
}

export function memoryUsageBytes(stats: MemoryStatsInput): number | null {
	const usage = stats.memory_stats?.usage;
	if (usage === undefined) return null;
	const cache = stats.memory_stats?.stats?.cache ?? 0;
	const used = usage - cache;
	return used >= 0 ? used : usage;
}

export function memoryLimitBytes(stats: MemoryStatsInput): number | null {
	const limit = stats.memory_stats?.limit;
	if (limit === undefined || limit <= 0) return null;
	return limit;
}
