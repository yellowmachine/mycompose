export type RuntimePort = { host: number; container: number; protocol: string };

export type RuntimeService = {
	name: string;
	state: string;
	cpuPercent: number | null;
	memoryBytes: number | null;
	memoryLimitBytes: number | null;
	statsUnavailable: boolean;
	ports: RuntimePort[];
};

export type RuntimeSnapshot = {
	dockerUnavailable: boolean;
	services: RuntimeService[];
};

export function dedupeRuntimePorts(ports: RuntimePort[]): RuntimePort[] {
	const seen = new Set<string>();
	const out: RuntimePort[] = [];
	for (const port of ports) {
		const key = `${port.host}:${port.container}/${port.protocol}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(port);
	}
	return out;
}

export function uniqueHostPorts(services: RuntimeService[]): number[] {
	return [...new Set(services.flatMap((svc) => svc.ports.map((port) => port.host)))];
}
