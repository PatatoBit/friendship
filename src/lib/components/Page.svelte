<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ColorPicker from './ColorPicker.svelte';

	type Tool = 'draw' | 'text';
	type Item = {
		id: number;
		kind: 'text';
		x: number;
		y: number;
		value: string;
		color?: string;
		w?: number;
		h?: number;
	};

	const tools: { id: Tool; label: string }[] = [
		{ id: 'draw', label: 'Draw' },
		{ id: 'text', label: 'Text' }
	];
	const MIN_W = 96;
	const MIN_H = 48;

	let tool = $state<Tool>('draw');
	let color = $state('#3a2e2a');
	let items = $state<Item[]>([]);
	let editingId = $state<number | null>(null);
	let canvas: HTMLCanvasElement;
	let board: HTMLDivElement;
	let editor: HTMLTextAreaElement | undefined = $state();
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let dragging: Item | null = null;
	let interacting = false;
	let boxDrag: { item: Item; ox: number; oy: number } | null = null;
	let boxResize:
		| { item: Item; startX: number; startY: number; startW: number; startH: number }
		| null = null;

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

	$effect(() => {
		if (editingId == null || !editor) return;
		editor.focus({ preventScroll: true });
		const len = editor.value.length;
		editor.setSelectionRange(len, len);
	});

	function pos(e: PointerEvent) {
		const r = board.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function clamp(n: number, min: number, max: number) {
		return Math.max(min, Math.min(max, n));
	}

	function defaultTextSize(x: number, y: number) {
		const maxW = Math.max(MIN_W, board.clientWidth - x - 12);
		const maxH = Math.max(MIN_H, board.clientHeight - y - 12);
		return {
			w: Math.min(200, maxW),
			h: Math.min(72, maxH)
		};
	}

	async function startEditing(id: number) {
		editingId = id;
		await tick();
	}

	function commitText(forId?: number) {
		if (editingId == null || interacting) return;
		if (forId != null && editingId !== forId) return;
		const id = editingId;
		editingId = null;
		const item = items.find((i) => i.id === id);
		if (!item) return;
		item.value = item.value.trimEnd();
		if (!item.value.trim()) items = items.filter((i) => i.id !== id);
	}

	function down(e: PointerEvent) {
		const p = pos(e);
		if (tool === 'draw') {
			commitText();
			drawing = true;
			canvas.setPointerCapture(e.pointerId);
			ctx.strokeStyle = color;
			ctx.lineWidth = e.pointerType === 'pen' ? 2 + e.pressure * 6 : 4;
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
		} else {
			commitText();
			const id = Date.now();
			const size = defaultTextSize(p.x, p.y);
			items.push({ id, kind: 'text', x: p.x, y: p.y, value: '', color, ...size });
			startEditing(id);
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
		if (tool === 'text') {
			commitText();
			if (item.w == null || item.h == null) {
				const size = defaultTextSize(item.x, item.y);
				item.w ??= size.w;
				item.h ??= size.h;
			}
			startEditing(item.id);
			return;
		}
		if (editingId != null) return;
		dragging = item;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function itemMove(e: PointerEvent) {
		if (!dragging) return;
		const p = pos(e);
		dragging.x = p.x;
		dragging.y = p.y;
	}

	function beginBoxDrag(e: PointerEvent, item: Item) {
		e.stopPropagation();
		e.preventDefault();
		interacting = true;
		const p = pos(e);
		boxDrag = { item, ox: p.x - item.x, oy: p.y - item.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onBoxDragMove(e: PointerEvent) {
		if (!boxDrag) return;
		const p = pos(e);
		const w = boxDrag.item.w ?? MIN_W;
		const h = boxDrag.item.h ?? MIN_H;
		boxDrag.item.x = clamp(p.x - boxDrag.ox, 0, board.clientWidth - w);
		boxDrag.item.y = clamp(p.y - boxDrag.oy, 0, board.clientHeight - h);
	}

	function endBoxDrag(e: PointerEvent) {
		if (!boxDrag) return;
		boxDrag = null;
		interacting = false;
		editor?.focus({ preventScroll: true });
	}

	function beginResize(e: PointerEvent, item: Item) {
		e.stopPropagation();
		e.preventDefault();
		interacting = true;
		boxResize = {
			item,
			startX: e.clientX,
			startY: e.clientY,
			startW: item.w ?? MIN_W,
			startH: item.h ?? MIN_H
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onResizeMove(e: PointerEvent) {
		if (!boxResize) return;
		const maxW = Math.max(MIN_W, board.clientWidth - boxResize.item.x - 8);
		const maxH = Math.max(MIN_H, board.clientHeight - boxResize.item.y - 8);
		boxResize.item.w = clamp(boxResize.startW + (e.clientX - boxResize.startX), MIN_W, maxW);
		boxResize.item.h = clamp(boxResize.startH + (e.clientY - boxResize.startY), MIN_H, maxH);
	}

	function endResize() {
		if (!boxResize) return;
		boxResize = null;
		interacting = false;
		editor?.focus({ preventScroll: true });
	}

	function onEditorBlur(id: number) {
		// Delay so resize/move handles can set interacting / restore focus first
		requestAnimationFrame(() => {
			if (interacting || boxDrag || boxResize) return;
			if (editingId === id && document.activeElement !== editor) commitText(id);
		});
	}

	function onEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			commitText();
		}
	}
</script>

<div class="page">
	<div class="board" bind:this={board}>
		<canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={() => (drawing = false)}></canvas>
		{#each items as item (item.id)}
			{#if editingId === item.id}
				<div
					class="text-box editing"
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width="{item.w}px"
					style:height="{item.h}px"
					style:color={item.color ?? color}
					onpointerdown={(e) => e.stopPropagation()}
				>
					<div
						class="move-bar"
						aria-label="Move text"
						role="presentation"
						onpointerdown={(e) => beginBoxDrag(e, item)}
						onpointermove={onBoxDragMove}
						onpointerup={endBoxDrag}
						onpointercancel={endBoxDrag}
					></div>
					<textarea
						bind:this={editor}
						class="editor"
						bind:value={item.value}
						rows="1"
						enterkeyhint="done"
						aria-label="Page text"
						autocomplete="off"
						autocorrect="on"
						autocapitalize="sentences"
						onblur={() => onEditorBlur(item.id)}
						onkeydown={onEditorKeydown}
					></textarea>
					<button
						type="button"
						class="resize-handle"
						aria-label="Resize text box"
						onpointerdown={(e) => beginResize(e, item)}
						onpointermove={onResizeMove}
						onpointerup={endResize}
						onpointercancel={endResize}
					></button>
				</div>
			{:else}
				<div
					class="text-box"
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width={item.w ? `${item.w}px` : undefined}
					style:height={item.h ? `${item.h}px` : undefined}
					style:color={item.color ?? color}
					onpointerdown={(e) => itemDown(e, item)}
					onpointermove={itemMove}
					onpointerup={() => (dragging = null)}
					role="presentation"
				>
					{item.value}
				</div>
			{/if}
		{/each}
	</div>

	<div class="toolbar">
		{#each tools as t}
			<button
				type="button"
				class="tool"
				class:active={tool === t.id}
				aria-label={t.label}
				onclick={() => (tool = t.id)}
			>
				{#if t.id === 'draw'}
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path
							fill="currentColor"
							d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.37-8.62 1.83-1.83a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75Z"
						/>
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path fill="currentColor" d="M5 4v3h5.5v12h3V7H19V4H5Z" />
					</svg>
				{/if}
			</button>
		{/each}
		<div class="color-slot">
			<ColorPicker bind:color />
		</div>
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
		overflow: visible;
	}
	.color-slot {
		margin-left: auto;
	}
	.tool {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		padding: 0;
		svg {
			width: 1.25rem;
			height: 1.25rem;
		}
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
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.text-box {
		position: absolute;
		box-sizing: border-box;
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.35;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		overflow: hidden;
		user-select: none;
		touch-action: none;
		max-width: calc(100% - 0.5rem);

		&.editing {
			display: flex;
			flex-direction: column;
			overflow: visible;
			background: color-mix(in srgb, white 88%, currentColor);
			border: 2px solid color-mix(in srgb, currentColor 55%, #ff7aa2);
			border-radius: 0.75rem;
			box-shadow: 0 8px 24px rgba(58, 46, 42, 0.16);
			touch-action: auto;
			user-select: text;
		}
	}
	.move-bar {
		flex: 0 0 1.35rem;
		margin: 0.2rem 0.35rem 0;
		border-radius: 999px;
		background: color-mix(in srgb, currentColor 22%, transparent);
		touch-action: none;
		cursor: grab;
		&::after {
			content: '';
			display: block;
			width: 2rem;
			height: 0.2rem;
			margin: 0.55rem auto 0;
			border-radius: 999px;
			background: color-mix(in srgb, currentColor 55%, transparent);
		}
	}
	.editor {
		flex: 1;
		width: 100%;
		min-height: 0;
		margin: 0;
		padding: 0.35rem 0.55rem 0.55rem;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		caret-color: currentColor;
		color: inherit;
		font: inherit;
		font-size: 1.125rem; // ≥16px — avoids iOS input zoom
		font-weight: 600;
		line-height: 1.35;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		overflow: auto;
		-webkit-user-select: text;
		user-select: text;
		touch-action: manipulation;
	}
	.resize-handle {
		position: absolute;
		right: -0.35rem;
		bottom: -0.35rem;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border-radius: 50%;
		background: #ff7aa2;
		box-shadow: 0 2px 8px rgba(58, 46, 42, 0.25);
		touch-action: none;
		cursor: nwse-resize;
		&::after {
			content: '';
			position: absolute;
			inset: 0.7rem;
			border-right: 2px solid white;
			border-bottom: 2px solid white;
			border-radius: 0 0 2px 0;
		}
	}
</style>
