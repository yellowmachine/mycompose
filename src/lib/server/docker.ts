import Docker from 'dockerode';
import {
	dedupeRuntimePorts,
	type RuntimePort,
	type RuntimeService,
	type RuntimeSnapshot
} from '../runtime';
import { composeProjectName } from './compose';
import { dockerSock } from './config';
import {
	cpuPercent,
	memoryLimitBytes,
	memoryUsageBytes,
	type CpuStatsInput,
	type MemoryStatsInput
} from './docker-stats';

export type { RuntimePort, RuntimeService, RuntimeSnapshot };

function client(): Docker {
	return new Docker({ socketPath: dockerSock() });
}

export async function pingDocker(): Promise<boolean> {
	try {
		const docker = client();
		await Promise.race([
			docker.ping(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
		]);
		return true;
	} catch {
		return false;
	}
}

export async function listProjectContainers(slug: string): Promise<Docker.ContainerInfo[]> {
	const project = composeProjectName(slug);
	return client().listContainers({
		all: true,
		filters: { label: [`com.docker.compose.project=${project}`] }
	});
}

export async function findRunningServiceContainer(
	slug: string,
	service: string
): Promise<{ id: string } | null> {
	const containers = await listProjectContainers(slug);
	const match = containers.find(
		(info) => info.State === 'running' && info.Labels?.['com.docker.compose.service'] === service
	);
	return match ? { id: match.Id } : null;
}

async function oneShotStats(id: string): Promise<Record<string, unknown> | null> {
	try {
		const stats = await Promise.race([
			client().getContainer(id).stats({ stream: false }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
		]);
		return stats as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

function publishedPorts(info: Docker.ContainerInfo): RuntimePort[] {
	const ports: RuntimePort[] = [];
	for (const port of info.Ports ?? []) {
		if (!port.PublicPort) continue;
		ports.push({
			host: port.PublicPort,
			container: port.PrivatePort,
			protocol: port.Type || 'tcp'
		});
	}
	return dedupeRuntimePorts(ports);
}

export async function projectRuntime(slug: string): Promise<RuntimeSnapshot> {
	const up = await pingDocker();
	if (!up) return { dockerUnavailable: true, services: [] };

	let containers: Docker.ContainerInfo[];
	try {
		containers = await listProjectContainers(slug);
	} catch {
		return { dockerUnavailable: true, services: [] };
	}

	const services: RuntimeService[] = [];
	for (const info of containers) {
		const name =
			info.Labels?.['com.docker.compose.service'] || info.Names?.[0] || info.Id.slice(0, 12);
		const running = info.State === 'running';
		let cpu: number | null = null;
		let mem: number | null = null;
		let limit: number | null = null;
		let statsUnavailable = true;
		if (running) {
			const stats = await oneShotStats(info.Id);
			if (stats) {
				cpu = cpuPercent(stats as CpuStatsInput);
				mem = memoryUsageBytes(stats as MemoryStatsInput);
				limit = memoryLimitBytes(stats as MemoryStatsInput);
				statsUnavailable = cpu === null && mem === null;
			}
		}
		services.push({
			name,
			state: info.State,
			cpuPercent: running ? cpu : null,
			memoryBytes: running ? mem : null,
			memoryLimitBytes: running ? limit : null,
			statsUnavailable: running ? statsUnavailable : true,
			ports: running ? publishedPorts(info) : []
		});
	}

	services.sort((a, b) => a.name.localeCompare(b.name));
	return { dockerUnavailable: false, services };
}
