<script lang="ts">
	import { onMount } from 'svelte';

	type Tool = 'draw' | 'text' | 'sticker';
	type Item = { id: number; kind: 'text' | 'sticker'; x: number; y: number; value: string };

	const stickers = ['💖', '🌸', '⭐', '🐻', '🍓', '🌈', '✨', '🎀'];
	const colors = ['#3a2e2a', '#ff7aa2', '#6bb5ff', '#7bd389', '#ffc94d'];

	let tool = $state<Tool>('draw');
	let color = $state(colors[0]);
	let sticker = $state(stickers[0]);
	let items = $state<Item[]>([]);
	let canvas: HTMLCanvasElement;
	let board: HTMLDivElement;
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let dragging: Item | null = null;

	function resize() {
		const r = board.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const snapshot = canvas.width ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
		canvas.width = r.width * dpr;
		canvas.height = r.height * dpr;
		ctx.scale(dpr, dpr);
		ctx.lineCap = ctx.lineJoin = 'round';
		if (snapshot) ctx.putImageData(snapshot, 0, 0);
	}

	onMount(() => {
		ctx = canvas.getContext('2d')!;
		resize();
		window.addEventListener('resize', resize);
		return () => window.removeEventListener('resize', resize);
	});

	function pos(e: PointerEvent) {
		const r = board.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function down(e: PointerEvent) {
		const p = pos(e);
		if (tool === 'draw') {
			drawing = true;
			canvas.setPointerCapture(e.pointerId);
			ctx.strokeStyle = color;
			ctx.lineWidth = e.pointerType === 'pen' ? 2 + e.pressure * 6 : 4;
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
		} else if (tool === 'sticker') {
			items.push({ id: Date.now(), kind: 'sticker', x: p.x, y: p.y, value: sticker });
		} else {
			const value = prompt('Write something');
			if (value) items.push({ id: Date.now(), kind: 'text', x: p.x, y: p.y, value });
		}
	}

	function move(e: PointerEvent) {
		if (!drawing) return;
		const p = pos(e);
		ctx.lineTo(p.x, p.y);
		ctx.stroke();
	}

	function itemDown(e: PointerEvent, item: Item) {
		e.stopPropagation();
		dragging = item;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function itemMove(e: PointerEvent) {
		if (!dragging) return;
		const p = pos(e);
		dragging.x = p.x;
		dragging.y = p.y;
	}
</script>

<div class="toolbar">
	{#each ['draw', 'text', 'sticker'] as t}
		<button class:active={tool === t} onclick={() => (tool = t as Tool)}>{t}</button>
	{/each}
	{#if tool === 'draw' || tool === 'text'}
		{#each colors as c}
			<button class="swatch" class:active={color === c} style:background={c} aria-label={c} onclick={() => (color = c)}></button>
		{/each}
	{:else}
		{#each stickers as s}
			<button class:active={sticker === s} onclick={() => (sticker = s)}>{s}</button>
		{/each}
	{/if}
</div>

<div class="board" bind:this={board}>
	<canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={() => (drawing = false)}></canvas>
	{#each items as item (item.id)}
		<div
			class="item {item.kind}"
			style:left="{item.x}px"
			style:top="{item.y}px"
			style:color={color}
			onpointerdown={(e) => itemDown(e, item)}
			onpointermove={itemMove}
			onpointerup={() => (dragging = null)}
			role="presentation"
		>{item.value}</div>
	{/each}
</div>

<style lang="scss">
	.toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		padding-top: max(0.75rem, env(safe-area-inset-top));
		overflow-x: auto;
		.swatch { width: 2.2rem; height: 2.2rem; padding: 0; &.active { outline: 3px solid white; outline-offset: -6px; } }
	}
	.board {
		position: relative;
		margin: 0 0.75rem 0.75rem;
		height: calc(100dvh - 5rem);
		background: white;
		border-radius: 1rem;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		touch-action: none;
	}
	canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
	.item {
		position: absolute;
		transform: translate(-50%, -50%);
		user-select: none;
		touch-action: none;
		&.sticker { font-size: 3rem; }
		&.text { font-size: 1.4rem; font-weight: 600; white-space: pre-wrap; }
	}
</style>
