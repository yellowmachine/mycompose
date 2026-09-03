export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}

export function sseEncoder() {
	const encoder = new TextEncoder();
	return {
		pack(data: unknown): Uint8Array {
			return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
		}
	};
}
