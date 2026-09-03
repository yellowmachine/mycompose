import type { Handle, ServerInit } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apps, deploys } from '$lib/server/db/schema';
import { execWebsocket, prepareExecUpgrade } from '$lib/server/exec-ws';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return resolve(event);
	}
	const prepared = await prepareExecUpgrade(event.request);
	if (!prepared.ok) {
		return new Response(prepared.message, { status: prepared.status });
	}
	const server = event.platform?.server;
	const request = event.platform?.request ?? event.request;
	if (!server) {
		return new Response('WebSocket not available', { status: 503 });
	}
	const upgraded = server.upgrade(request, { data: prepared.data });
	if (!upgraded) {
		return new Response('Upgrade failed', { status: 400 });
	}
	return new Response(null, { status: 101 });
};

export const websocket = execWebsocket;

export const init: ServerInit = async () => {
	try {
		await db
			.update(deploys)
			.set({
				status: 'failed',
				errorSummary: 'Interrupted by process restart',
				finishedAt: new Date()
			})
			.where(inArray(deploys.status, ['pending', 'deploying']));
		await db
			.update(apps)
			.set({ status: 'failed', updatedAt: new Date() })
			.where(inArray(apps.status, ['deploying']));
	} catch (error) {
		console.error('Boot reconcile skipped:', error);
	}
};
