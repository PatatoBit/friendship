<script lang="ts">
	import { onMount } from 'svelte';
	import ColorPicker from './ColorPicker.svelte';

	type Tool = 'draw' | 'text' | 'sticker';
	type Item = { id: number; kind: 'text' | 'sticker'; x: number; y: number; value: string };

	const stickers = ['💖', '🌸', '⭐', '🐻', '🍓', '🌈', '✨', '🎀'];

	let tool = $state<Tool>('draw');
	let color = $state('#3a2e2a');
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

<div class="page">
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

	<div class="toolbar">
		{#each ['draw', 'text', 'sticker'] as t}
			<button class:active={tool === t} onclick={() => (tool = t as Tool)}>{t}</button>
		{/each}
		{#if tool === 'draw' || tool === 'text'}
			<ColorPicker bind:color />
		{:else}
			{#each stickers as s}
				<button class:active={sticker === s} onclick={() => (sticker = s)}>{s}</button>
			{/each}
		{/if}
	</div>
</div>

<style lang="scss">
	.page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		padding-top: env(safe-area-inset-top);
	}
	.toolbar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
		overflow-x: auto;
		overflow-y: visible;
	}
	.board {
		position: relative;
		flex: 1;
		min-height: 0;
		margin: 0.75rem 0.75rem 0;
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
