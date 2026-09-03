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
