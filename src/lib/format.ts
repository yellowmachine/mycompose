export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

export function formatCpu(pct: number): string {
	return `${pct.toFixed(1)}%`;
}
