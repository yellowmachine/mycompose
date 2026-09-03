<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>mycompose</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen">
	<header class="border-b border-zinc-800">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
			<a href="/" class="text-sm font-semibold tracking-tight">mycompose</a>
			<a href="/apps/new" class="text-sm text-zinc-400 hover:text-zinc-100">New app</a>
		</div>
	</header>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>
