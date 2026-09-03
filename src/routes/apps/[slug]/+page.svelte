<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import LogViewer from '$lib/components/LogViewer.svelte';
	import ServiceTerminal from '$lib/components/ServiceTerminal.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatBytes, formatCpu } from '$lib/format';
	import { uniqueHostPorts, type RuntimeSnapshot } from '$lib/runtime';

	let { data, form } = $props();

	function shortSha(sha: string | null | undefined): string {
		return sha ? sha.slice(0, 7) : '—';
	}

	function duration(start: Date | string, end: Date | string | null): string {
		if (!end) return '…';
		const ms = new Date(end).getTime() - new Date(start).getTime();
		if (ms < 1000) return `${ms}ms`;
		return `${Math.round(ms / 1000)}s`;
	}

	type EnvRow = { key: string; value: string };

	let envRows = $state<EnvRow[]>(
		untrack(() =>
			data.envVars.length > 0
				? data.envVars.map((row) => ({ key: row.key, value: row.value }))
				: [{ key: '', value: '' }]
		)
	);

	let runtime = $state<RuntimeSnapshot | null>(null);

	async function loadRuntime() {
		try {
			const res = await fetch(`/api/apps/${data.app.slug}/runtime`);
			if (!res.ok) return;
			runtime = (await res.json()) as RuntimeSnapshot;
		} catch {
			runtime = { dockerUnavailable: true, services: [] };
		}
	}

	const publishedPorts = $derived(uniqueHostPorts(runtime?.services ?? []));

	onMount(() => {
		void loadRuntime();
		const tick = () => {
			if (data.app.status === 'deploying') void invalidateAll();
			void loadRuntime();
		};
		const id = setInterval(tick, 3000);
		return () => clearInterval(id);
	});
</script>

<div class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-xl font-semibold">{data.app.name}</h1>
		<p class="font-mono text-sm text-zinc-400">{data.app.slug}</p>
	</div>
	<div class="flex items-center gap-3">
		<StatusBadge status={data.app.status} />
		<span
			class="font-mono text-sm text-zinc-400"
			data-testid="live-sha"
			title={data.app.liveSha ?? ''}
		>
			live {shortSha(data.app.liveSha)}
		</span>
		{#if publishedPorts.length > 0}
			<span class="font-mono text-sm text-zinc-400" data-testid="published-ports">
				{#each publishedPorts as port, i (port)}
					{i > 0 ? ' ' : ''}:{port}
				{/each}
			</span>
		{/if}
	</div>
</div>

{#if runtime?.dockerUnavailable}
	<p
		class="mb-4 rounded-md border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-200"
		data-testid="docker-unavailable"
	>
		Docker is unavailable. App records still load; runtime actions will fail.
	</p>
{/if}

{#if form?.error}
	<p class="mb-4 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
		{form.error}
	</p>
{/if}
{#if form?.saved}
	<p class="mb-4 text-sm text-emerald-400">Saved.</p>
{/if}
{#if form?.envSaved}
	<p class="mb-4 text-sm text-emerald-400">Environment saved. Takes effect on the next deploy.</p>
{/if}

<section class="mb-8 rounded-lg border border-zinc-800 p-4" data-testid="runtime">
	<h2 class="mb-3 text-sm font-medium text-zinc-400">Runtime</h2>
	{#if !runtime}
		<p class="text-sm text-zinc-500">Loading runtime…</p>
	{:else if runtime.services.length === 0}
		<p class="text-sm text-zinc-500" data-testid="runtime-empty">No services reporting.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead class="text-zinc-400">
					<tr>
						<th class="px-2 py-1 font-medium">Service</th>
						<th class="px-2 py-1 font-medium">State</th>
						<th class="px-2 py-1 font-medium">CPU</th>
						<th class="px-2 py-1 font-medium">Memory</th>
					</tr>
				</thead>
				<tbody>
					{#each runtime.services as svc (svc.name)}
						<tr class="border-t border-zinc-800" data-testid="runtime-row">
							<td class="px-2 py-1 font-mono">{svc.name}</td>
							<td class="px-2 py-1">{svc.state}</td>
							<td class="px-2 py-1 font-mono">
								{#if svc.state !== 'running'}
									<span class="text-zinc-500">—</span>
								{:else if svc.statsUnavailable || svc.cpuPercent === null}
									<span class="text-zinc-500" data-testid="stats-unavailable">unavailable</span>
								{:else}
									<span data-testid="cpu">{formatCpu(svc.cpuPercent)}</span>
								{/if}
							</td>
							<td class="px-2 py-1 font-mono">
								{#if svc.state !== 'running'}
									<span class="text-zinc-500">—</span>
								{:else if svc.statsUnavailable || svc.memoryBytes === null}
									<span class="text-zinc-500" data-testid="stats-unavailable">unavailable</span>
								{:else}
									<span data-testid="memory"
										>{formatBytes(svc.memoryBytes)}{svc.memoryLimitBytes
											? ` / ${formatBytes(svc.memoryLimitBytes)}`
											: ''}</span
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="mb-8 rounded-lg border border-zinc-800 p-4">
	<h2 class="mb-4 text-sm font-medium text-zinc-400">Source</h2>
	<form method="POST" action="?/update" class="flex max-w-xl flex-col gap-3">
		<label class="field">
			Name
			<input name="name" required value={data.app.name} />
		</label>
		<label class="field">
			Git URL
			<input name="gitUrl" required value={data.app.gitUrl} />
		</label>
		<label class="field">
			Branch
			<input name="branch" required value={data.app.branch} />
		</label>
		<label class="field">
			Compose file path
			<input name="composePath" required value={data.app.composePath} />
			<span class="text-xs text-zinc-500">
				Public HTTPS Git only. Named volumes persist; bind mounts to the clone directory do not.
			</span>
		</label>
		<div class="flex gap-3">
			<button class="btn" type="submit">Save</button>
		</div>
	</form>
	<div class="mt-4 flex flex-wrap gap-3">
		<form method="POST" action="?/deploy">
			<button class="btn btn-primary" type="submit" disabled={data.app.status === 'deploying'}>
				{data.app.status === 'deploying' ? 'Deploying…' : 'Deploy'}
			</button>
		</form>
		<form method="POST" action="?/stop">
			<button class="btn" type="submit" disabled={data.app.status !== 'running'}>Stop</button>
		</form>
		<form method="POST" action="?/start">
			<button class="btn" type="submit" disabled={data.app.status !== 'stopped'}>Start</button>
		</form>
	</div>
</section>

<section class="mb-8 rounded-lg border border-zinc-800 p-4">
	<h2 class="mb-1 text-sm font-medium text-zinc-400">Environment</h2>
	<p class="mb-4 text-xs text-zinc-500">
		Used for Compose interpolation and container environment on the next deploy. Running containers
		keep the previous snapshot until then.
	</p>
	<form method="POST" action="?/saveEnv" class="flex max-w-xl flex-col gap-3">
		{#each envRows as _, i (i)}
			<div class="flex gap-2">
				<input name="key" placeholder="KEY" class="flex-1 font-mono" bind:value={envRows[i].key} />
				<input
					name="value"
					placeholder="value"
					class="flex-1 font-mono"
					bind:value={envRows[i].value}
				/>
				<button
					class="btn"
					type="button"
					onclick={() => {
						envRows = envRows.filter((_, idx) => idx !== i);
						if (envRows.length === 0) envRows = [{ key: '', value: '' }];
					}}>Remove</button
				>
			</div>
		{/each}
		<div class="flex gap-3">
			<button
				class="btn"
				type="button"
				onclick={() => {
					envRows = [...envRows, { key: '', value: '' }];
				}}>Add variable</button
			>
			<button class="btn btn-primary" type="submit">Save environment</button>
		</div>
	</form>
</section>

<section>
	<h2 class="mb-3 text-sm font-medium text-zinc-400">Deploys</h2>
	{#if data.deploys.length === 0}
		<p class="text-sm text-zinc-500">No deploys yet.</p>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-zinc-800">
			<table class="w-full text-left text-sm">
				<thead class="bg-zinc-900 text-zinc-400">
					<tr>
						<th class="px-3 py-2 font-medium">SHA</th>
						<th class="px-3 py-2 font-medium">Branch</th>
						<th class="px-3 py-2 font-medium">Status</th>
						<th class="px-3 py-2 font-medium">Started</th>
						<th class="px-3 py-2 font-medium">Duration</th>
						<th class="px-3 py-2 font-medium">Log</th>
					</tr>
				</thead>
				<tbody>
					{#each data.deploys as deploy (deploy.id)}
						<tr class="border-t border-zinc-800">
							<td class="px-3 py-2 font-mono" title={deploy.sha ?? ''}>{shortSha(deploy.sha)}</td>
							<td class="px-3 py-2 font-mono text-zinc-400">{deploy.branch}</td>
							<td class="px-3 py-2"><StatusBadge status={deploy.status} /></td>
							<td class="px-3 py-2 text-zinc-400">
								{new Date(deploy.startedAt).toISOString().replace('T', ' ').slice(0, 19)}
							</td>
							<td class="px-3 py-2 text-zinc-400">
								{duration(deploy.startedAt, deploy.finishedAt)}
							</td>
							<td class="px-3 py-2">
								<a class="underline" href="/apps/{data.app.slug}/deploys/{deploy.id}">view</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="mt-8 mb-8" data-testid="container-logs">
	<h2 class="mb-3 text-sm font-medium text-zinc-400">Container logs</h2>
	{#key data.app.status}
		<LogViewer src="/api/apps/{data.app.slug}/logs" emptyMessage="No running containers" />
	{/key}
</section>

<ServiceTerminal slug={data.app.slug} services={runtime?.services ?? []} />

<section class="mt-8 rounded-lg border border-red-950 p-4">
	<h2 class="mb-1 text-sm font-medium text-red-300">Destroy</h2>
	<p class="mb-4 text-xs text-zinc-500">
		Removes containers and networks. Named volumes stay on the host. Type the slug to confirm.
	</p>
	<form method="POST" action="?/destroy" class="flex max-w-xl flex-wrap gap-2">
		<input name="confirm" placeholder={data.app.slug} class="flex-1 font-mono" autocomplete="off" />
		<button class="btn btn-danger" type="submit">Destroy</button>
	</form>
</section>
