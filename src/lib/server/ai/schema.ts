import * as z from 'zod';
import { CAUSE_CLASSES, CONFIDENCE_LEVELS } from '../db/schema';

export const explanationSchema = z.object({
	cause_class: z.enum(CAUSE_CLASSES),
	summary: z.string().min(1),
	evidence: z.array(z.string().min(1)).min(1).max(5),
	next_checks: z.array(z.string().min(1)).min(1).max(5),
	confidence: z.enum(CONFIDENCE_LEVELS)
});

export type ExplanationPayload = z.infer<typeof explanationSchema>;

export function explanationJsonSchema(): Record<string, unknown> {
	return z.toJSONSchema(explanationSchema) as Record<string, unknown>;
}

export function coerceExplanation(raw: string): ExplanationPayload {
	try {
		const parsed = explanationSchema.safeParse(JSON.parse(raw));
		if (parsed.success) return parsed.data;
	} catch {
		// not JSON
	}
	const trimmed = raw.trim().slice(0, 500);
	return {
		cause_class: 'unknown',
		summary: trimmed || 'The model returned an unusable response.',
		evidence: ['(unparsed model output)'],
		next_checks: ['Read the deploy log on this page.'],
		confidence: 'low'
	};
}
