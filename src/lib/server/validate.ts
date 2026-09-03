import * as z from 'zod';
import { SLUG_RE, slugify } from '../slug';

export { SLUG_RE, slugify };
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const slugSchema = z
	.string()
	.trim()
	.min(1, 'Slug is required')
	.max(48, 'Slug must be at most 48 characters')
	.regex(SLUG_RE, 'Slug must be lowercase letters, digits, and hyphens, and start with a letter');

export const envKeySchema = z
	.string()
	.trim()
	.min(1, 'Key is required')
	.regex(ENV_KEY_RE, 'Environment key must match [A-Za-z_][A-Za-z0-9_]*');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long');

export const branchSchema = z
	.string()
	.trim()
	.min(1, 'Branch is required')
	.max(255, 'Branch name is too long');

export function parseGitUrl(
	raw: string,
	allowLocal: boolean
): { ok: true; url: string } | { ok: false; error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, error: 'Git URL is required' };

	if (allowLocal) {
		if (trimmed.startsWith('/') || trimmed.startsWith('file://')) {
			return { ok: true, url: trimmed };
		}
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { ok: false, error: 'Invalid Git URL' };
	}

	if (url.protocol !== 'https:') {
		return { ok: false, error: 'Git URL must be HTTPS' };
	}
	if (url.username || url.password) {
		return { ok: false, error: 'Credentials in Git URL are not allowed' };
	}
	if (!url.hostname) {
		return { ok: false, error: 'Invalid Git URL' };
	}
	return { ok: true, url: trimmed };
}

export function validateComposePath(
	raw: string
): { ok: true; path: string } | { ok: false; error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, error: 'Compose path is required' };
	if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
		return { ok: false, error: 'Compose path must be relative to the repo root' };
	}
	const parts = trimmed.split(/[/\\]/).filter((p) => p.length > 0 && p !== '.');
	if (parts.some((p) => p === '..')) {
		return { ok: false, error: 'Compose path must not contain ..' };
	}
	if (parts.length === 0) {
		return { ok: false, error: 'Compose path is required' };
	}
	return { ok: true, path: parts.join('/') };
}

export const createAppSchema = z.object({
	name: nameSchema,
	slug: slugSchema,
	gitUrl: z.string().trim().min(1, 'Git URL is required'),
	branch: branchSchema.default('main'),
	composePath: z.string().trim().min(1).default('docker-compose.yml')
});

export const updateAppSchema = z.object({
	name: nameSchema,
	gitUrl: z.string().trim().min(1, 'Git URL is required'),
	branch: branchSchema,
	composePath: z.string().trim().min(1, 'Compose path is required')
});

export type EnvRow = { key: string; value: string };

export function parseEnvRows(
	keys: string[],
	values: string[]
): { ok: true; rows: EnvRow[] } | { ok: false; error: string } {
	const rows: EnvRow[] = [];
	const seen = new Set<string>();
	const n = Math.max(keys.length, values.length);
	for (let i = 0; i < n; i++) {
		const key = (keys[i] ?? '').trim();
		const value = values[i] ?? '';
		if (!key && value === '') continue;
		if (!key) {
			return { ok: false, error: 'Environment key is required when a value is set' };
		}
		const parsed = envKeySchema.safeParse(key);
		if (!parsed.success) {
			return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid environment key' };
		}
		if (seen.has(parsed.data)) {
			return { ok: false, error: `Duplicate environment key: ${parsed.data}` };
		}
		seen.add(parsed.data);
		rows.push({ key: parsed.data, value });
	}
	return { ok: true, rows };
}
