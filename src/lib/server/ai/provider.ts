import OpenAI, {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	NotFoundError
} from 'openai';
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
Quote only strings that appear in the pack.
Classify cause_class as one of: git, compose, build, image, port, runtime, config, unknown.
- git: clone, ls-remote, branch lookup, or Git URL failed
- compose: compose file missing, invalid YAML, or compose parse/up failed because of that file
- build: image build failed
- image: pull or tag of an image failed
- port: published port conflict
- runtime: container started then crashed
- config: env or app settings, not the compose file itself
- unknown: only if none of the above fit
If deploy_finished is false, say the log is incomplete.
next_checks are for a human in the panel or on the host; do not claim you changed Git, Docker, or env.
Reply with a JSON object: cause_class, summary, evidence (1-5 strings), next_checks (1-5 strings), confidence (low|medium|high).`;

function client(): OpenAI {
	return new OpenAI({
		apiKey: 'ollama',
		baseURL: ollamaBaseUrl(),
		timeout: PROVIDER_TIMEOUT_MS,
		maxRetries: 0
	});
}

export async function explainWithOllama(pack: EvidencePack): Promise<ModelResult> {
	const base = ollamaBaseUrl();
	const model = ollamaModel();
	try {
		const completion = await client().chat.completions.create({
			model,
			temperature: 0.2,
			max_tokens: 1024,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM },
				{ role: 'user', content: JSON.stringify(pack) }
			]
		});
		const raw = completion.choices[0]?.message?.content ?? '';
		return { payload: coerceExplanation(raw), model, raw: raw || null };
	} catch (error) {
		if (error instanceof APIConnectionTimeoutError) {
			throw new ProviderError(`Ollama timed out at ${base}`, 504);
		}
		if (error instanceof NotFoundError) {
			throw new ProviderError(`Ollama model not found (${model})`, 502);
		}
		if (error instanceof APIConnectionError) {
			throw new ProviderError(`Ollama is not reachable at ${base}`, 502);
		}
		if (error instanceof APIError) {
			throw new ProviderError(`Ollama returned HTTP ${error.status}`, 502);
		}
		throw new ProviderError(`Ollama is not reachable at ${base}`, 502);
	}
}
