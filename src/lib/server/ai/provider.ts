import { ollamaBaseUrl, ollamaModel } from '../config';
import type { EvidencePack } from './evidence';
import { coerceExplanation, type ExplanationPayload } from './schema';

export const PROVIDER_TIMEOUT_MS = 120_000;

export class ProviderError extends Error {
	status: 502 | 504;
	constructor(message: string, status: 502 | 504 = 502) {
		super(message);
		this.name = 'ProviderError';
		this.status = status;
	}
}

export type ModelResult = {
	payload: ExplanationPayload;
	model: string;
	raw: string | null;
};

const SYSTEM = `You diagnose a single mycompose deploy from the evidence pack JSON only.
Quote only strings that appear in the pack. Classify cause_class as one of: git, compose, build, image, port, runtime, config, unknown.
If deploy_finished is false, say the log is incomplete.
next_checks are for a human in the panel or on the host; do not claim you changed Git, Docker, or env.
Reply with a JSON object: cause_class, summary, evidence (1-5 strings), next_checks (1-5 strings), confidence (low|medium|high).`;

export async function explainWithOllama(pack: EvidencePack): Promise<ModelResult> {
	const base = ollamaBaseUrl();
	const model = ollamaModel();
	let res: Response;
	try {
		res = await fetch(`${base}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer ollama'
			},
			body: JSON.stringify({
				model,
				temperature: 0.2,
				max_tokens: 1024,
				response_format: { type: 'json_object' },
				messages: [
					{ role: 'system', content: SYSTEM },
					{ role: 'user', content: JSON.stringify(pack) }
				]
			}),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			throw new ProviderError(`Ollama timed out at ${base}`, 504);
		}
		throw new ProviderError(`Ollama is not reachable at ${base}`, 502);
	}

	if (res.status === 404) {
		throw new ProviderError(`Ollama model not found (${model})`, 502);
	}
	if (!res.ok) {
		throw new ProviderError(`Ollama returned HTTP ${res.status}`, 502);
	}

	const body = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const raw = body.choices?.[0]?.message?.content ?? '';
	return { payload: coerceExplanation(raw), model, raw: raw || null };
}
