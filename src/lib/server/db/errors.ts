export function isUniqueViolation(error: unknown, constraint?: string): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const e = error as { code?: string; constraint_name?: string; constraint?: string };
	if (e.code !== '23505') return false;
	if (!constraint) return true;
	return e.constraint_name === constraint || e.constraint === constraint;
}
