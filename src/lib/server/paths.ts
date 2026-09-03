import path from 'node:path';

export function resolveInside(root: string, rel: string): string {
	const rootResolved = path.resolve(root);
	const resolved = path.resolve(root, rel);
	if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
		throw new Error('Path escapes repository root');
	}
	return resolved;
}
