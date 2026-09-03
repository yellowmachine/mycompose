import path from 'node:path';

export function dataDir(): string {
	return path.resolve(process.env.MYCOMPOSE_DATA_DIR || 'data');
}

export function allowLocalGit(): boolean {
	const v = process.env.MYCOMPOSE_ALLOW_LOCAL_GIT;
	return v === '1' || v === 'true';
}

export function dockerSock(): string {
	return process.env.DOCKER_SOCK || '/var/run/docker.sock';
}

export function appDataDir(slug: string): string {
	return path.join(dataDir(), 'apps', slug);
}

export function appRepoDir(slug: string): string {
	return path.join(appDataDir(slug), 'repo');
}

export function appEnvFile(slug: string): string {
	return path.join(appDataDir(slug), 'deploy.env');
}
