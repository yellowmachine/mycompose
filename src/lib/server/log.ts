export const LOG_CAP = 1_048_576;
const TRUNCATION_MARK = '\n\n[log truncated]\n';

export function appendLog(
	current: string,
	chunk: string,
	alreadyTruncated: boolean
): { text: string; truncated: boolean } {
	if (alreadyTruncated) return { text: current, truncated: true };
	if (!chunk) return { text: current, truncated: false };

	if (current.length >= LOG_CAP) {
		return { text: current + TRUNCATION_MARK, truncated: true };
	}

	const room = LOG_CAP - current.length;
	if (chunk.length <= room) {
		return { text: current + chunk, truncated: false };
	}

	return { text: current + chunk.slice(0, room) + TRUNCATION_MARK, truncated: true };
}
