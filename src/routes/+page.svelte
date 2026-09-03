<script lang="ts">
	import StatusBadge from '$lib/components/StatusBadge.svelte';

	let { data } = $props();

	function shortSha(sha: string | null): string {
		return sha ? sha.slice(0, 7) : '—';
	}
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-xl font-semibold">Apps</h1>
	<a href="/apps/new" class="btn btn-primary">New app</a>
</div>

{#if data.apps.length === 0}
	<p class="text-zinc-400">No apps yet. Create one from a public Git repository.</p>
{:else}
	<div class="overflow-x-auto rounded-lg border border-zinc-800">
		<table class="w-full text-left text-sm">
			<thead class="bg-zinc-900 text-zinc-400">
				<tr>
					<th class="px-3 py-2 font-medium">Name</th>
					<th class="px-3 py-2 font-medium">Slug</th>
					<th class="px-3 py-2 font-medium">Status</th>
					<th class="px-3 py-2 font-medium">Live SHA</th>
				</tr>
			</thead>
			<tbody>
				{#each data.apps as app (app.id)}
					<tr class="border-t border-zinc-800 hover:bg-zinc-900/60">
						<td class="px-3 py-2">
							<a href="/apps/{app.slug}" class="font-medium hover:underline">{app.name}</a>
						</td>
						<td class="px-3 py-2 font-mono text-zinc-400">{app.slug}</td>
						<td class="px-3 py-2"><StatusBadge status={app.status} /></td>
						<td class="px-3 py-2 font-mono text-zinc-400">{shortSha(app.liveSha)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
