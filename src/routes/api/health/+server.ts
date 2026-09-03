import { json } from '@sveltejs/kit';
import { pingDocker } from '$lib/server/docker';

export async function GET() {
	const docker = await pingDocker();
	return json({ ok: true, docker });
}
