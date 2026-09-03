const SIMPLE = /^[A-Za-z0-9_./:@+-]*$/;

export function encodeEnvValue(value: string): string {
	if (SIMPLE.test(value) && !value.includes('\n') && !value.includes('\r')) {
		return value;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function serializeEnvFile(vars: Record<string, string>): string {
	const lines = Object.entries(vars).map(([key, value]) => `${key}=${encodeEnvValue(value)}`);
	return lines.length ? lines.join('\n') + '\n' : '';
}
