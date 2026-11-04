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
		fontSize?: number;
	};

	const MIN_W = 96;
	const BASE_FONT = 20; // 1.25rem — keeps iOS from zooming on focus
	const LINE_HEIGHT = 1.4;
	const MIN_FONT = 12;
	const MAX_FONT = 160;
	const MOVE_SLOP = 12;

	function lineHeightPx(fontSize = BASE_FONT) {
		return Math.ceil(fontSize * LINE_HEIGHT);
	}

	const MIN_H = lineHeightPx(BASE_FONT);

	let tool = $state<Tool>('draw');
	let drawMode = $state<DrawMode>('pencil');
	let color = $state('#2c2622');
	let items = $state<Item[]>([]);
	let editingId = $state<number | null>(null);
	let canvas: HTMLCanvasElement;
	let board: HTMLDivElement;
	let editor: HTMLTextAreaElement | undefined = $state();
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let interacting = false;
	let movingId = $state<number | null>(null);
	/** Ignore the board tap that dismissed the editor so it doesn't place a replacement box */
	let skipNextTextCreate = false;
	let boxResize:
		| {
				item: Item;
				startX: number;
				startY: number;
				startW: number;
				startH: number;
				startFont: number;
		  }
		| null = null;
	let press: {
		item: Item;
		pointerId: number;
		startClientX: number;
		startClientY: number;
		ox: number;
		oy: number;
		dragging: boolean;
		target: HTMLElement;
		wasEditing: boolean;
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
		const oneLine = lineHeightPx(BASE_FONT);
		return {
			w: Math.min(200, maxW),
			h: Math.min(oneLine, maxH)
		};
	}

	function fitEditorToContent(item: Item) {
		if (!editor || editingId !== item.id) return;
		const minH = lineHeightPx(fontSizeOf(item));
		const maxH = Math.max(minH, board.clientHeight - item.y - 8);
		// Measure from a collapsed height so Enter/wrap grows line by line
		const prev = editor.style.height;
		editor.style.height = `${minH}px`;
		const next = clamp(editor.scrollHeight, minH, maxH);
		editor.style.height = prev;
		item.h = next;
	}

	function ensureSize(item: Item) {
		if (item.w == null || item.h == null) {
			const size = defaultTextSize(item.x, item.y);
			item.w ??= size.w;
			item.h ??= size.h;
		}
		item.fontSize ??= BASE_FONT;
	}

	function fontSizeOf(item: Item) {
		return item.fontSize ?? BASE_FONT;
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

	function startDragging() {
		if (!press || press.dragging) return;
		press.dragging = true;
		interacting = true;
		movingId = press.item.id;
		window.getSelection()?.removeAllRanges();
		// Blur so the caret/keyboard don't fight the drag
		if (press.wasEditing) editor?.blur();
	}

	function beginPress(e: PointerEvent, item: Item) {
		e.stopPropagation();
		if (press) clearPress();
		ensureSize(item);
		const p = pos(e);
		const target = e.currentTarget as HTMLElement;
		const wasEditing = editingId === item.id;
		// Idle: block scroll/selection so a slide can drag. Editing: allow caret on tap.
		if (!wasEditing) e.preventDefault();
		try {
			target.setPointerCapture(e.pointerId);
		} catch {
			/* pointer already gone */
		}
		press = {
			item,
			pointerId: e.pointerId,
			startClientX: e.clientX,
			startClientY: e.clientY,
			ox: p.x - item.x,
			oy: p.y - item.y,
			dragging: false,
			target,
			wasEditing
		};
	}

	function onPressMove(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		if (!press.dragging) {
			const dx = e.clientX - press.startClientX;
			const dy = e.clientY - press.startClientY;
			if (dx * dx + dy * dy <= MOVE_SLOP * MOVE_SLOP) return;
			startDragging();
		}
		e.preventDefault();
		moveItemTo(press.item, e.clientX, e.clientY, press.ox, press.oy);
	}

	function endPress(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		const { item, dragging, wasEditing } = press;
		press = null;
		movingId = null;
		if (dragging) {
			interacting = false;
			return;
		}
		// Short tap on an idle box → edit
		if (!wasEditing) {
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
			// Tap out while editing = confirm (keep the box). Don't start a new one.
			if (editingId != null) {
				commitText();
				return;
			}
			// Blur often commits before this handler — ignore that same tap
			if (skipNextTextCreate) {
				skipNextTextCreate = false;
				return;
			}
			// Only one empty box at a time — drop blanks, keep boxes that have text
			const id = Date.now();
			const size = defaultTextSize(p.x, p.y);
			items = [
				...items.filter((i) => i.value.trim()),
				{
					id,
					kind: 'text',
					x: p.x,
					y: p.y,
					value: '',
					color,
					fontSize: BASE_FONT,
					...size
				}
			];
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
		ensureSize(item);
		interacting = true;
		boxResize = {
			item,
			startX: e.clientX,
			startY: e.clientY,
			startW: item.w ?? MIN_W,
			startH: item.h ?? MIN_H,
			startFont: fontSizeOf(item)
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onResizeMove(e: PointerEvent) {
		if (!boxResize) return;
		const minH = lineHeightPx(MIN_FONT);
		const maxW = Math.max(MIN_W, board.clientWidth - boxResize.item.x - 8);
		const maxH = Math.max(minH, board.clientHeight - boxResize.item.y - 8);
		const w = clamp(boxResize.startW + (e.clientX - boxResize.startX), MIN_W, maxW);
		const h = clamp(boxResize.startH + (e.clientY - boxResize.startY), minH, maxH);
		boxResize.item.w = w;
		boxResize.item.h = h;
		// Scale type with the box (geometric mean keeps it even when aspect drifts)
		const scale = Math.sqrt((w / boxResize.startW) * (h / boxResize.startH));
		boxResize.item.fontSize = clamp(boxResize.startFont * scale, MIN_FONT, MAX_FONT);
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
			if (editingId === id && document.activeElement !== editor) {
				commitText(id);
				// The same tap that blurred often lands on the board — don't treat it as "add new"
				skipNextTextCreate = true;
			}
		});
	}

	function onEditorKeydown(e: KeyboardEvent, item: Item) {
		if (e.key === 'Escape') {
			e.preventDefault();
			commitText();
			return;
		}
		// Grow after Enter / wrap updates layout
		if (e.key === 'Enter') {
			queueMicrotask(() => fitEditorToContent(item));
		}
	}

	function onEditorInput(item: Item) {
		fitEditorToContent(item);
	}

	function onEditorPointerDown(e: PointerEvent, item: Item) {
		// Tap places the caret; sliding past the slop drags the box
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
					style:font-size="{fontSizeOf(item)}px"
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
						onkeydown={(e) => onEditorKeydown(e, item)}
						oninput={() => onEditorInput(item)}
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
					style:font-size="{fontSizeOf(item)}px"
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
		background: var(--surface);
		box-shadow: 0 1px 4px oklch(0.3 0.02 52 / 0.1);
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
				background: var(--accent);
				color: var(--surface);
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
		background: var(--surface);
		border-radius: 1rem;
		box-shadow: 0 2px 12px oklch(0.3 0.02 52 / 0.08);
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
		padding: 0;
		border: 0;
		font-family: 'Sa Ard Pen', system-ui, sans-serif;
		font-size: 1.25rem; // fallback before inline size is set
		font-weight: normal;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		overflow: hidden;
		user-select: none;
		touch-action: none;
		max-width: calc(100% - 0.5rem);

		// Ring via box-shadow so it doesn't shift the text
		&.empty {
			box-shadow: 0 0 0 2px color-mix(in oklch, var(--select) 45%, transparent);
		}

		&.moving {
			opacity: 0.92;
			cursor: grabbing;
		}

		&.editing {
			overflow: visible;
			background: transparent;
			border-radius: 0;
			box-shadow: 0 0 0 2px var(--select);
			touch-action: none;
			user-select: text;
		}
	}
	.editor {
		display: block;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		caret-color: currentColor;
		color: inherit;
		font: inherit;
		font-size: inherit;
		font-weight: normal;
		line-height: 1.4;
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
		border: 2px solid var(--select);
		border-radius: 2px;
		background: var(--surface);
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
			border-right: 2px solid var(--select);
			border-bottom: 2px solid var(--select);
		}
	}
</style>
