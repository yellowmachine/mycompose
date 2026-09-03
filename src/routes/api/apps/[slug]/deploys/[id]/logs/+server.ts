import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apps, deploys } from '$lib/server/db/schema';
import { sseEncoder, sseResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

const POLL_MS = 400;
const TERMINAL = new Set(['succeeded', 'failed']);

export const GET: RequestHandler = async ({ params, request }) => {
	const [app] = await db.select().from(apps).where(eq(apps.slug, params.slug)).limit(1);
	if (!app) error(404, 'App not found');

	const [deploy] = await db
		.select()
		.from(deploys)
		.where(and(eq(deploys.id, params.id), eq(deploys.appId, app.id)))
		.limit(1);
	if (!deploy) error(404, 'Deploy not found');

	const { pack } = sseEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let lastText = '';
			let lastStatus = '';
			let lastTruncated = false;
			try {
				while (!request.signal.aborted) {
					const [row] = await db.select().from(deploys).where(eq(deploys.id, deploy.id)).limit(1);
					if (!row) {
						controller.enqueue(pack({ error: 'Deploy not found', done: true }));
						break;
					}
					if (
						row.logText !== lastText ||
						row.status !== lastStatus ||
						row.logTruncated !== lastTruncated
					) {
						controller.enqueue(
							pack({
								text: row.logText,
								status: row.status,
								truncated: row.logTruncated
							})
						);
						lastText = row.logText;
						lastStatus = row.status;
						lastTruncated = row.logTruncated;
					}
					if (TERMINAL.has(row.status)) {
						controller.enqueue(
							pack({ done: true, status: row.status, truncated: row.logTruncated })
						);
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, POLL_MS));
				}
			} catch {
				// client gone
			} finally {
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		},
		cancel() {
			// request.signal abort handles the loop
		}
	});

	return sseResponse(stream);
};
