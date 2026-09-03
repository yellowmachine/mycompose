<script lang="ts">
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { onMount } from 'svelte';
	import type { RuntimeService } from '$lib/runtime';
	import '@xterm/xterm/css/xterm.css';

	let { slug, services }: { slug: string; services: RuntimeService[] } = $props();

	const running = $derived(services.filter((svc) => svc.state === 'running'));

	let selected = $state('');
	let error = $state('');
	let connected = $state(false);
	let hostEl = $state<HTMLDivElement | undefined>(undefined);

	let term: Terminal | undefined;
	let fit: FitAddon | undefined;
	let socket: WebSocket | undefined;
	let resizeObserver: ResizeObserver | undefined;

	$effect(() => {
		if (running.length === 0) {
			selected = '';
			return;
		}
		if (!running.some((svc) => svc.name === selected)) {
			selected = running[0].name;
		}
	});

	function disconnect() {
		socket?.close();
		socket = undefined;
		connected = false;
	}

	function connect() {
		if (!selected || !term) return;
		error = '';
		disconnect();
		fit?.fit();
		const path = `/ws/apps/${encodeURIComponent(slug)}/services/${encodeURIComponent(selected)}/exec?cols=${term.cols}&rows=${term.rows}`;
		// Vite's WS proxy is unreliable under `bun --bun vite`; talk to ws-dev directly.
		const url = import.meta.env.DEV
			? `ws://127.0.0.1:${import.meta.env.VITE_WS_PORT || 5174}${path}`
			: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
		const ws = new WebSocket(url);
		ws.binaryType = 'arraybuffer';
		socket = ws;
		ws.onopen = () => {
			connected = true;
			term?.focus();
		};
		ws.onmessage = (event) => {
			if (typeof event.data === 'string') {
				try {
					const parsed = JSON.parse(event.data) as { type?: string; message?: string };
					if (parsed.type === 'error' && parsed.message) {
						error = parsed.message;
						return;
					}
				} catch {
					// raw terminal text
				}
				term?.write(event.data);
				return;
			}
			const bytes = new Uint8Array(event.data as ArrayBuffer);
			term?.write(bytes);
		};
		ws.onerror = () => {
			error = error || 'Could not open terminal';
		};
		ws.onclose = () => {
			if (socket === ws) {
				connected = false;
				socket = undefined;
			}
		};
	}

	onMount(() => {
		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			theme: {
				background: '#09090b',
				foreground: '#e4e4e7',
				cursor: '#e4e4e7'
			}
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		if (hostEl) terminal.open(hostEl);
		fitAddon.fit();
		term = terminal;
		fit = fitAddon;

		terminal.onData((data) => {
			if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
		});
		terminal.onResize((size) => {
			if (socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
			}
		});

		resizeObserver = new ResizeObserver(() => fitAddon.fit());
		if (hostEl) resizeObserver.observe(hostEl);

		return () => {
			resizeObserver?.disconnect();
			disconnect();
			terminal.dispose();
			term = undefined;
			fit = undefined;
		};
	});
</script>

<section class="mt-8 mb-8 rounded-lg border border-zinc-800 p-4" data-testid="service-terminal">
	<h2 class="mb-3 text-sm font-medium text-zinc-400">Terminal</h2>
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<select data-testid="terminal-service" bind:value={selected} disabled={running.length === 0}>
			{#if running.length === 0}
				<option value="">No running service</option>
			{:else}
				{#each running as svc (svc.name)}
					<option value={svc.name}>{svc.name}</option>
				{/each}
			{/if}
		</select>
		<button
			class="btn"
			type="button"
			data-testid="open-terminal"
			disabled={running.length === 0 || !selected}
			onclick={connect}
		>
			Open terminal
		</button>
		<button class="btn" type="button" disabled={!connected} onclick={disconnect}>Close</button>
	</div>
	{#if running.length === 0}
		<p class="mb-3 text-sm text-zinc-500">Service is not running</p>
	{/if}
	{#if error}
		<p class="mb-3 text-sm text-red-300" data-testid="terminal-error">{error}</p>
	{/if}
	<div
		bind:this={hostEl}
		data-testid="terminal"
		data-connected={connected ? 'true' : 'false'}
		class="h-64 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2"
	></div>
</section>
