export const SLUG_RE = /^[a-z](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function slugify(name: string): string {
	const base = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	if (!base) return '';
	if (!/^[a-z]/.test(base)) return `a-${base}`.slice(0, 48).replace(/-$/, '');
	if (base.length === 1) return base;
	return base.replace(/-$/, '');
}
