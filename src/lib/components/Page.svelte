<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ColorPicker from './ColorPicker.svelte';

	type Tool = 'draw' | 'text';
	type DrawMode = 'pencil' | 'eraser';
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

	const MIN_W = 96;
	const MIN_H = 48;
	const LONG_PRESS_MS = 420;
	const MOVE_SLOP = 10;

	let tool = $state<Tool>('draw');
	let drawMode = $state<DrawMode>('pencil');
	let color = $state('#3a2e2a');
	let items = $state<Item[]>([]);
	let editingId = $state<number | null>(null);
	let canvas: HTMLCanvasElement;
	let board: HTMLDivElement;
	let editor: HTMLTextAreaElement | undefined = $state();
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let interacting = false;
	let movingId = $state<number | null>(null);
	let boxResize:
		| { item: Item; startX: number; startY: number; startW: number; startH: number }
		| null = null;
	let press: {
		item: Item;
		pointerId: number;
		startClientX: number;
		startClientY: number;
		ox: number;
		oy: number;
		timer: ReturnType<typeof setTimeout>;
		dragging: boolean;
		target: HTMLElement;
	} | null = null;

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
		return () => {
			window.removeEventListener('resize', resize);
			clearPress();
		};
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

	function ensureSize(item: Item) {
		if (item.w == null || item.h == null) {
			const size = defaultTextSize(item.x, item.y);
			item.w ??= size.w;
			item.h ??= size.h;
		}
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
	}

	function clearPress() {
		if (!press) return;
		clearTimeout(press.timer);
		press = null;
		movingId = null;
	}

	function moveItemTo(item: Item, clientX: number, clientY: number, ox: number, oy: number) {
		const r = board.getBoundingClientRect();
		const w = item.w ?? MIN_W;
		const h = item.h ?? MIN_H;
		item.x = clamp(clientX - r.left - ox, 0, board.clientWidth - w);
		item.y = clamp(clientY - r.top - oy, 0, board.clientHeight - h);
	}

	function beginPress(e: PointerEvent, item: Item) {
		e.stopPropagation();
		if (press) clearPress();
		ensureSize(item);
		const p = pos(e);
		const pointerId = e.pointerId;
		const target = e.currentTarget as HTMLElement;
		press = {
			item,
			pointerId,
			startClientX: e.clientX,
			startClientY: e.clientY,
			ox: p.x - item.x,
			oy: p.y - item.y,
			dragging: false,
			target,
			timer: setTimeout(() => {
				if (!press || press.pointerId !== pointerId) return;
				press.dragging = true;
				interacting = true;
				movingId = item.id;
				try {
					target.setPointerCapture(pointerId);
				} catch {
					/* already released */
				}
				if (editingId === item.id) editor?.blur();
				window.getSelection()?.removeAllRanges();
			}, LONG_PRESS_MS)
		};
	}

	function onPressMove(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		if (press.dragging) {
			e.preventDefault();
			moveItemTo(press.item, e.clientX, e.clientY, press.ox, press.oy);
			return;
		}
		const dx = e.clientX - press.startClientX;
		const dy = e.clientY - press.startClientY;
		if (dx * dx + dy * dy > MOVE_SLOP * MOVE_SLOP) {
			clearTimeout(press.timer);
			// Finger moved before long-press — cancel; don't start a drag
			press = null;
		}
	}

	function endPress(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		const { item, dragging } = press;
		clearTimeout(press.timer);
		press = null;
		movingId = null;
		if (dragging) {
			interacting = false;
			if (editingId === item.id) editor?.focus({ preventScroll: true });
			return;
		}
		// Short tap → edit
		if (editingId !== item.id) {
			commitText();
			startEditing(item.id);
		}
	}

	function selectDraw(mode: DrawMode = 'pencil') {
		tool = 'draw';
		drawMode = mode;
	}

	function selectText() {
		tool = 'text';
		drawMode = 'pencil';
	}

	function down(e: PointerEvent) {
		const p = pos(e);
		if (tool === 'draw') {
			commitText();
			drawing = true;
			canvas.setPointerCapture(e.pointerId);
			const penWidth = e.pointerType === 'pen' ? 2 + e.pressure * 6 : 4;
			ctx.lineWidth = drawMode === 'eraser' ? Math.max(16, penWidth * 3) : penWidth;
			ctx.strokeStyle = color;
			ctx.globalCompositeOperation = drawMode === 'eraser' ? 'destination-out' : 'source-over';
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

	function up() {
		if (!drawing) return;
		drawing = false;
		ctx.globalCompositeOperation = 'source-over';
	}

	function beginResize(e: PointerEvent, item: Item) {
		e.stopPropagation();
		e.preventDefault();
		clearPress();
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
		// Delay so resize/move can set interacting / restore focus first
		requestAnimationFrame(() => {
			if (interacting || press?.dragging || boxResize) return;
			if (editingId === id && document.activeElement !== editor) commitText(id);
		});
	}

	function onEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			commitText();
		}
	}

	function onEditorPointerDown(e: PointerEvent, item: Item) {
		// Allow caret placement on short taps; long-press still moves the box
		beginPress(e, item);
	}
</script>

<div class="page">
	<div class="board" bind:this={board}>
		<canvas
			bind:this={canvas}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		></canvas>
		{#each items as item (item.id)}
			{#if editingId === item.id}
				<div
					class="text-box editing"
					class:moving={movingId === item.id}
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width="{item.w}px"
					style:height="{item.h}px"
					style:color={item.color ?? color}
					role="group"
					aria-label="Text box"
					onpointerdown={(e) => beginPress(e, item)}
					onpointermove={onPressMove}
					onpointerup={endPress}
					onpointercancel={endPress}
				>
					<textarea
						bind:this={editor}
						class="editor"
						bind:value={item.value}
						rows="1"
						enterkeyhint="done"
						aria-label="Page text"
						autocomplete="off"
						autocapitalize="sentences"
						onpointerdown={(e) => onEditorPointerDown(e, item)}
						onpointermove={onPressMove}
						onpointerup={endPress}
						onpointercancel={endPress}
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
					class:empty={!item.value.trim()}
					class:moving={movingId === item.id}
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width={item.w ? `${item.w}px` : undefined}
					style:height={item.h ? `${item.h}px` : undefined}
					style:color={item.color ?? color}
					onpointerdown={(e) => beginPress(e, item)}
					onpointermove={onPressMove}
					onpointerup={endPress}
					onpointercancel={endPress}
					role="presentation"
				>
					{item.value}
				</div>
			{/if}
		{/each}
	</div>

	<div class="toolbar">
		<div class="draw-pill" class:open={tool === 'draw'} aria-label="Drawing tools">
			<button
				type="button"
				class="tool"
				class:active={tool === 'draw' && drawMode === 'pencil'}
				aria-label="Pencil"
				aria-pressed={tool === 'draw' && drawMode === 'pencil'}
				onclick={() => selectDraw('pencil')}
			>
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
					/>
					<path
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						d="m15 5 4 4"
					/>
				</svg>
			</button>
			<div class="eraser-slot" class:open={tool === 'draw'}>
				<button
					type="button"
					class="tool"
					class:active={drawMode === 'eraser'}
					aria-label="Eraser"
					aria-pressed={drawMode === 'eraser'}
					tabindex={tool === 'draw' ? 0 : -1}
					onclick={() => selectDraw('eraser')}
				>
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"
						/>
						<path
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M22 21H7"
						/>
						<path
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m5 11 9 9"
						/>
					</svg>
				</button>
			</div>
		</div>
		<button
			type="button"
			class="tool"
			class:active={tool === 'text'}
			aria-label="Text"
			onclick={selectText}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M5 4v3h5.5v12h3V7H19V4H5Z" />
			</svg>
		</button>
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
	.draw-pill {
		--pill-ease: cubic-bezier(0.23, 1, 0.32, 1);
		display: grid;
		grid-template-columns: auto 0fr;
		align-items: center;
		height: 2.6rem;
		padding: 0.15rem;
		border-radius: 999px;
		background: white;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
		transition: grid-template-columns 220ms var(--pill-ease);

		&.open {
			grid-template-columns: auto 1fr;
		}

		.tool {
			position: relative;
			z-index: 1;
			width: 2.3rem;
			height: 2.3rem;
			box-shadow: none;
			background: transparent;
			transition:
				background-color 150ms ease,
				color 150ms ease,
				transform 150ms ease;

			&:active {
				transform: scale(0.94);
			}

			&.active {
				background: #ff7aa2;
				color: white;
			}
		}
	}
	.eraser-slot {
		display: grid;
		min-width: 0;
		overflow: hidden;
		opacity: 0;
		transform: translateX(-0.55rem) scale(0.86);
		transform-origin: left center;
		pointer-events: none;
		transition:
			opacity 180ms var(--pill-ease),
			transform 220ms var(--pill-ease);

		&.open {
			opacity: 1;
			transform: none;
			pointer-events: auto;
		}

		.tool {
			margin-inline-start: 0.1rem;
		}
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
	@media (prefers-reduced-motion: reduce) {
		.draw-pill,
		.draw-pill .tool,
		.eraser-slot {
			transition: none;
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

		&.empty {
			border: 2px solid color-mix(in srgb, #f5c518 45%, transparent);
		}

		&.moving {
			opacity: 0.92;
		}

		&.editing {
			overflow: visible;
			background: transparent;
			border: 2px solid #f5c518;
			border-radius: 0;
			box-shadow: none;
			touch-action: none;
			user-select: text;
		}
	}
	.editor {
		display: block;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0.35rem 0.45rem;
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
		touch-action: none;
	}
	.resize-handle {
		position: absolute;
		right: -0.4rem;
		bottom: -0.4rem;
		width: 1.15rem;
		height: 1.15rem;
		padding: 0;
		border: 2px solid #f5c518;
		border-radius: 2px;
		background: #fff;
		box-shadow: none;
		touch-action: none;
		cursor: nwse-resize;
		&::after {
			content: '';
			position: absolute;
			right: 2px;
			bottom: 2px;
			width: 0.45rem;
			height: 0.45rem;
			border-right: 2px solid #f5c518;
			border-bottom: 2px solid #f5c518;
		}
	}
</style>
