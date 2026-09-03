<script lang="ts">
	import { onMount, untrack } from 'svelte';

	let {
		src,
		initial = '',
		truncated = false,
		emptyMessage = 'No running containers'
	}: {
		src: string;
		initial?: string;
		truncated?: boolean;
		emptyMessage?: string;
	} = $props();

	let text = $state(untrack(() => initial));
	let truncatedFlag = $state(untrack(() => truncated));
	let empty = $state(false);
	let error = $state('');
	let preEl = $state<HTMLPreElement | undefined>(undefined);

	function scrollToEnd() {
		if (preEl) preEl.scrollTop = preEl.scrollHeight;
	}

	onMount(() => {
		const es = new EventSource(src);
		es.onmessage = (event) => {
			let msg: {
				text?: string;
				chunk?: string;
				truncated?: boolean;
				status?: string;
				done?: boolean;
				empty?: boolean;
				error?: string;
			};
			try {
				msg = JSON.parse(event.data) as typeof msg;
			} catch {
				return;
			}
			if (msg.empty) {
				empty = true;
				es.close();
				return;
			}
			if (msg.error) {
				error = msg.error;
				es.close();
				return;
			}
			if (msg.truncated) truncatedFlag = true;
			if (typeof msg.text === 'string') text = msg.text;
			if (typeof msg.chunk === 'string') text += msg.chunk;
			queueMicrotask(scrollToEnd);
			if (msg.done) es.close();
		};
		es.onerror = () => {
			if (es.readyState === EventSource.CLOSED && !text && !empty) {
				error = error || 'Log stream disconnected';
			}
		};
		return () => es.close();
	});
</script>

{#if truncatedFlag}
	<p class="mb-2 text-xs text-amber-400">Log truncated at 1 MiB.</p>
{/if}
{#if error}
	<p class="mb-2 text-sm text-red-300">{error}</p>
{/if}
{#if empty}
	<p class="text-sm text-zinc-500" data-testid="container-logs-empty">{emptyMessage}</p>
{:else}
	<pre
		bind:this={preEl}
		data-testid="log-viewer"
		class="max-h-[70vh] overflow-auto rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs leading-5 whitespace-pre-wrap">{text ||
			'Waiting for output…'}</pre>
{/if}
