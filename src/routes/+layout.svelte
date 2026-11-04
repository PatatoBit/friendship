<script lang="ts">
	import '$lib/styles/global.scss';
	let { children } = $props();
</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
	<title>Friendship Book</title>
</svelte:head>

{@render children()}
