<script lang="ts">
	type Status = 'draft' | 'deploying' | 'running' | 'stopped' | 'failed' | 'pending' | 'succeeded';

	let { status }: { status: Status | string } = $props();

	const styles: Record<string, string> = {
		draft: 'bg-zinc-800 text-zinc-300',
		pending: 'bg-zinc-800 text-zinc-300',
		deploying: 'bg-amber-950 text-amber-300',
		running: 'bg-emerald-950 text-emerald-300',
		succeeded: 'bg-emerald-950 text-emerald-300',
		stopped: 'bg-slate-800 text-slate-300',
		failed: 'bg-red-950 text-red-300'
	};
</script>

<span
	class="inline-flex rounded px-2 py-0.5 font-mono text-xs tracking-wide {styles[status] ??
		'bg-zinc-800 text-zinc-300'}"
>
	{status}
</span>
