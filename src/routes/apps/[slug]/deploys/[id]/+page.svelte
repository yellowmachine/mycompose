<script lang="ts">
	import LogViewer from '$lib/components/LogViewer.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';

	let { data } = $props();
</script>

<p class="mb-4 text-sm text-zinc-400">
	<a href="/apps/{data.app.slug}" class="underline">← {data.app.name}</a>
</p>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<h1 class="text-xl font-semibold">Deploy</h1>
	<StatusBadge status={data.deploy.status} />
	{#if data.deploy.sha}
		<span class="font-mono text-sm text-zinc-400">{data.deploy.sha}</span>
	{/if}
</div>

{#if data.deploy.errorSummary}
	<p class="mb-4 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
		{data.deploy.errorSummary}
	</p>
{/if}

{#if data.deploy.envSnapshot && Object.keys(data.deploy.envSnapshot).length > 0}
	<section class="mb-4 rounded-lg border border-zinc-800 p-4">
		<h2 class="mb-2 text-sm font-medium text-zinc-400">Environment snapshot</h2>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
			{#each Object.entries(data.deploy.envSnapshot) as [key, value] (key)}
				<dt class="text-zinc-400">{key}</dt>
				<dd class="break-all">{value}</dd>
			{/each}
		</dl>
	</section>
{:else}
	<p class="mb-4 text-xs text-zinc-500">No environment snapshot for this deploy.</p>
{/if}

<LogViewer
	src="/api/apps/{data.app.slug}/deploys/{data.deploy.id}/logs"
	initial={data.deploy.logText}
	truncated={data.deploy.logTruncated}
/>
