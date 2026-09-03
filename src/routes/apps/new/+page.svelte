<script lang="ts">
	import { untrack } from 'svelte';
	import { slugify } from '$lib/slug';

	let { form, data } = $props();
	let name = $state(untrack(() => form?.values?.name ?? ''));
	let slug = $state(untrack(() => form?.values?.slug ?? ''));
	let slugTouched = $state(untrack(() => Boolean(form?.values?.slug)));

	function onNameInput(event: Event) {
		name = (event.target as HTMLInputElement).value;
		if (!slugTouched) slug = slugify(name);
	}
</script>

<h1 class="mb-6 text-xl font-semibold">New app</h1>

{#if form?.error}
	<p class="mb-4 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
		{form.error}
	</p>
{/if}

<form method="POST" class="flex max-w-xl flex-col gap-4">
	<label class="field">
		Name
		<input name="name" required value={name} oninput={onNameInput} />
	</label>
	<label class="field">
		Slug
		<input
			name="slug"
			required
			value={slug}
			oninput={(e) => {
				slugTouched = true;
				slug = (e.target as HTMLInputElement).value;
			}}
		/>
		<span class="text-xs text-zinc-500"
			>Immutable after create. Compose project: mycompose-&lt;slug&gt;</span
		>
	</label>
	<label class="field">
		Git URL
		<input
			name="gitUrl"
			required
			placeholder={data.allowLocalGit
				? 'https://github.com/org/repo.git or a local path'
				: 'https://github.com/org/repo.git'}
			value={form?.values?.gitUrl ?? ''}
		/>
	</label>
	<p class="text-xs text-zinc-500">
		Public HTTPS Git only. Named volumes persist; bind mounts to the clone directory do not.
	</p>
	<label class="field">
		Branch
		<input name="branch" value={form?.values?.branch ?? 'main'} />
	</label>
	<label class="field">
		Compose file path
		<input name="composePath" value={form?.values?.composePath ?? 'docker-compose.yml'} />
	</label>
	<div class="flex gap-3">
		<button class="btn btn-primary" type="submit">Create</button>
		<a href="/" class="btn">Cancel</a>
	</div>
</form>
