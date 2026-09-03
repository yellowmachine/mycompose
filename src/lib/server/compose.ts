export type ComposeCommand = 'up' | 'stop' | 'start' | 'down' | 'logs' | 'ps';

export function composeProjectName(slug: string): string {
	return `mycompose-${slug}`;
}

export function composeArgv(opts: {
	slug: string;
	repoRoot: string;
	composePath: string;
	envFile: string;
	command: ComposeCommand;
	extra?: string[];
}): string[] {
	const base = [
		'compose',
		'-p',
		composeProjectName(opts.slug),
		'--project-directory',
		opts.repoRoot,
		'-f',
		opts.composePath,
		'--env-file',
		opts.envFile
	];

	const extra = opts.extra ?? [];

	switch (opts.command) {
		case 'up':
			return [...base, 'up', '-d', '--build', ...extra];
		case 'stop':
			return [...base, 'stop', ...extra];
		case 'start':
			return [...base, 'start', ...extra];
		case 'down':
			if (extra.includes('-v') || extra.includes('--volumes')) {
				throw new Error('Volume removal is not allowed');
			}
			return [...base, 'down', ...extra];
		case 'logs':
			return [...base, 'logs', ...extra];
		case 'ps':
			return [...base, 'ps', ...extra];
	}
}
