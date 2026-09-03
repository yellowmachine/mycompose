function mergeSignals(user: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (!user) return timeout;
	return AbortSignal.any([user, timeout]);
}

async function readStream(
	stream: ReadableStream<Uint8Array> | null,
	onChunk?: (chunk: string) => void | Promise<void>
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			if (text && onChunk) await onChunk(text);
		}
	} finally {
		reader.releaseLock();
	}
}

export async function runCommand(
	argv: string[],
	opts: {
		cwd?: string;
		timeoutMs: number;
		signal?: AbortSignal;
		onChunk?: (chunk: string) => void | Promise<void>;
	}
): Promise<{ code: number }> {
	const signal = mergeSignals(opts.signal, opts.timeoutMs);
	if (signal.aborted) {
		throw new Error(abortMessage(signal));
	}

	const proc = Bun.spawn(argv, {
		cwd: opts.cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: 'ignore'
	});

	const onAbort = () => {
		try {
			proc.kill();
		} catch {
			// already exited
		}
	};
	signal.addEventListener('abort', onAbort, { once: true });

	try {
		await Promise.all([
			readStream(proc.stdout, opts.onChunk),
			readStream(proc.stderr, opts.onChunk)
		]);
		const code = await proc.exited;
		if (signal.aborted) {
			throw new Error(abortMessage(signal));
		}
		return { code: code ?? 1 };
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

export async function streamCommand(
	argv: string[],
	opts: {
		cwd?: string;
		signal: AbortSignal;
		onChunk?: (chunk: string) => void | Promise<void>;
	}
): Promise<{ code: number }> {
	if (opts.signal.aborted) {
		throw new Error(abortMessage(opts.signal));
	}

	const proc = Bun.spawn(argv, {
		cwd: opts.cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		stdin: 'ignore'
	});

	const onAbort = () => {
		try {
			proc.kill();
		} catch {
			// already exited
		}
	};
	opts.signal.addEventListener('abort', onAbort, { once: true });

	try {
		await Promise.all([
			readStream(proc.stdout, opts.onChunk),
			readStream(proc.stderr, opts.onChunk)
		]);
		const code = await proc.exited;
		if (opts.signal.aborted) {
			throw new Error(abortMessage(opts.signal));
		}
		return { code: code ?? 1 };
	} finally {
		opts.signal.removeEventListener('abort', onAbort);
	}
}

function abortMessage(signal: AbortSignal): string {
	const reason = signal.reason;
	if (reason instanceof DOMException && reason.name === 'TimeoutError') {
		return 'Timed out';
	}
	if (reason instanceof Error) return reason.message;
	if (typeof reason === 'string' && reason) return reason;
	return 'Cancelled';
}
