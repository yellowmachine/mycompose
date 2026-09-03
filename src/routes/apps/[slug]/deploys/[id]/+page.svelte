<script lang="ts">
	import LogViewer from '$lib/components/LogViewer.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';

	let { data, form } = $props();

	function asStrings(value: unknown): string[] {
		if (!Array.isArray(value)) return [];
		return value.filter((item): item is string => typeof item === 'string');
	}
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

<section class="mb-6 rounded-lg border border-zinc-800 p-4" data-testid="explanations">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-sm font-medium text-zinc-400">Explanation</h2>
		<form method="POST" action="?/explain">
			<button class="btn" type="submit" data-testid="explain">Explain</button>
		</form>
	</div>
	{#if form?.error}
		<p
			class="mb-3 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200"
			data-testid="explain-error"
		>
			{form.error}
		</p>
	{/if}
	{#if data.explanations.length === 0}
		<p class="text-sm text-zinc-500">No explanations yet.</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each data.explanations as exp (exp.id)}
				<li class="rounded-md border border-zinc-800 p-3" data-testid="explanation">
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<StatusBadge status={exp.causeClass} />
						<span class="font-mono text-xs text-zinc-500">{exp.model}</span>
						<span class="text-xs text-zinc-500">
							{new Date(exp.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
						</span>
						<span class="text-xs text-zinc-500">{exp.confidence}</span>
					</div>
					<p class="mb-2 text-sm">{exp.summary}</p>
					{#if asStrings(exp.evidence).length > 0}
						<ul class="mb-2 list-disc pl-5 font-mono text-xs text-zinc-400">
							{#each asStrings(exp.evidence) as quote, i (`${exp.id}-e-${i}`)}
								<li>{quote}</li>
							{/each}
						</ul>
					{/if}
					{#if asStrings(exp.nextChecks).length > 0}
						<ul class="list-disc pl-5 text-xs text-zinc-400">
							{#each asStrings(exp.nextChecks) as check, i (`${exp.id}-n-${i}`)}
								<li>{check}</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

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
