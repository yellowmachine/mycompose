const MAX_GLOBAL_DEPLOYS = 2;

type Job = {
	appId: string;
	run: (signal: AbortSignal) => Promise<void>;
	resolve: () => void;
};

const controllers = new Map<string, AbortController>();
const promises = new Map<string, Promise<void>>();
const waiters: Job[] = [];
let running = 0;

export function isInflight(appId: string): boolean {
	return controllers.has(appId);
}

export async function abortApp(appId: string, reason = 'Cancelled'): Promise<void> {
	const controller = controllers.get(appId);
	if (!controller) return;

	const pendingIdx = waiters.findIndex((job) => job.appId === appId);
	if (pendingIdx >= 0) {
		const job = waiters.splice(pendingIdx, 1)[0];
		controllers.delete(appId);
		promises.delete(appId);
		job.resolve();
		return;
	}

	controller.abort(reason);
	await promises.get(appId);
}

export function enqueue(appId: string, run: (signal: AbortSignal) => Promise<void>): void {
	if (controllers.has(appId)) {
		throw new Error('A deploy is already in progress');
	}
	const controller = new AbortController();
	controllers.set(appId, controller);
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	promises.set(appId, promise);
	waiters.push({ appId, run, resolve });
	pump();
}

function pump(): void {
	while (running < MAX_GLOBAL_DEPLOYS && waiters.length > 0) {
		const job = waiters.shift();
		if (!job) return;
		const controller = controllers.get(job.appId);
		if (!controller) {
			job.resolve();
			continue;
		}
		running += 1;
		void job
			.run(controller.signal)
			.catch(() => {
				// errors are recorded by the job itself
			})
			.finally(() => {
				running -= 1;
				controllers.delete(job.appId);
				promises.delete(job.appId);
				job.resolve();
				pump();
			});
	}
}
