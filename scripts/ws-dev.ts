import { execWebsocket, handleExecHttp } from '../src/lib/server/exec-ws.ts';

const port = Number(process.env.MYCOMPOSE_WS_PORT || 5174);

const server = Bun.serve({
	port,
	hostname: '127.0.0.1',
	fetch(req, srv) {
		const url = new URL(req.url);
		if (url.pathname.startsWith('/ws/apps/')) {
			return handleExecHttp(req, srv);
		}
		return new Response('Not found', { status: 404 });
	},
	websocket: execWebsocket
});

console.log(`exec websocket listening on ws://127.0.0.1:${server.port}`);
