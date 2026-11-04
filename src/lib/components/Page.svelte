<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { haptic } from '#lib/haptics.ts';
	import { canvasToPngBlob, loadPage, savePage, type PersistedItem } from '#lib/page/persist.ts';
	import ColorPicker from './ColorPicker.svelte';
	import SizePicker from './SizePicker.svelte';
	import StickerSheet from './StickerSheet.svelte';

	type Tool = 'draw' | 'text';
	type DrawMode = 'pencil' | 'eraser';
	type TextItem = {
		id: number;
		kind: 'text';
		x: number;
		y: number;
		value: string;
		color?: string;
		w?: number;
		h?: number;
		fontSize?: number;
		rotation?: number;
	};
	type StickerItem = {
		id: number;
		kind: 'sticker';
		x: number;
		y: number;
		src: string;
		w: number;
		h: number;
		rotation?: number;
	};
	type Item = TextItem | StickerItem;

	const MIN_W = 96;
	const MIN_STICKER = 48;
	const DEFAULT_STICKER = 120;
	const BASE_FONT = 20; // 1.25rem — keeps iOS from zooming on focus
	const LINE_HEIGHT = 1.4;
	const MIN_FONT = 12;
	const MAX_FONT = 160;
	const MOVE_SLOP = 12;
	const DEFAULT_BRUSH = 4;
	/** Distance (px) where the trash lid starts opening */
	const TRASH_APPROACH = 160;
	/** Distance (px) that counts as “over the bin” */
	const TRASH_HIT = 56;

	function lineHeightPx(fontSize = BASE_FONT) {
		return Math.ceil(fontSize * LINE_HEIGHT);
	}

	const MIN_H = lineHeightPx(BASE_FONT);

	let tool = $state<Tool>('draw');
	let drawMode = $state<DrawMode>('pencil');
	let color = $state('#3a2e2a');
	let brushSize = $state(DEFAULT_BRUSH);
	let items = $state<Item[]>([]);
	let editingId = $state<number | null>(null);
	let selectedId = $state<number | null>(null);
	let canvas: HTMLCanvasElement;
	let board: HTMLDivElement;
	let editor: HTMLTextAreaElement | undefined = $state();
	let ctx: CanvasRenderingContext2D;
	let drawing = false;
	let drawX = 0;
	let drawY = 0;
	/** Live eraser preview under the pointer (CSS px diameter matches erase width) */
	let eraserCursor = $state<{ x: number; y: number } | null>(null);
	let interacting = false;
	let movingId = $state<number | null>(null);
	let trashEl: HTMLDivElement | undefined = $state();
	/** 0–1 how open the trash lid is (proximity) */
	let trashOpen = $state(0);
	let overTrash = $state(false);
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
	let boxRotate:
		| {
				item: Item;
				startPointerAngle: number;
				startRotation: number;
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
		hitText: boolean;
	} | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let ready = $state(false);
	/** Pixels to lift the board so the active text stays above the soft keyboard */
	let keyboardOffset = $state(0);
	const MAX_HISTORY = 40;
	type HistoryEntry = { items: Item[]; drawing: HTMLCanvasElement };
	let history = $state<HistoryEntry[]>([]);
	let canUndo = $derived(ready && history.length > 0);

	function resize() {
		const r = board.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		let backup: HTMLCanvasElement | null = null;
		if (canvas.width && canvas.height) {
			backup = document.createElement('canvas');
			backup.width = canvas.width;
			backup.height = canvas.height;
			backup.getContext('2d')!.drawImage(canvas, 0, 0);
		}
		canvas.width = r.width * dpr;
		canvas.height = r.height * dpr;
		ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.lineCap = ctx.lineJoin = 'round';
		if (backup) ctx.drawImage(backup, 0, 0, r.width, r.height);
	}

	function serializedItems(): PersistedItem[] {
		return items.map((item) =>
			isSticker(item)
				? {
						id: item.id,
						kind: 'sticker',
						x: item.x,
						y: item.y,
						src: item.src,
						w: item.w,
						h: item.h,
						rotation: item.rotation
					}
				: {
						id: item.id,
						kind: 'text',
						x: item.x,
						y: item.y,
						value: item.value,
						color: item.color,
						w: item.w,
						h: item.h,
						fontSize: item.fontSize,
						rotation: item.rotation
					}
		);
	}

	async function persistNow() {
		if (!ready || !board || !canvas) return;
		try {
			const drawing = await canvasToPngBlob(canvas);
			await savePage({
				drawing,
				boardWidth: board.clientWidth,
				boardHeight: board.clientHeight,
				items: serializedItems()
			});
		} catch (err) {
			console.error(err);
		}
	}

	function scheduleSave() {
		if (!ready) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void persistNow();
		}, 280);
	}

	function cloneItems(list: Item[]): Item[] {
		return list.map((item) => ({ ...item }));
	}

	function pushHistory() {
		if (!ready || !canvas) return;
		const drawing = document.createElement('canvas');
		drawing.width = canvas.width;
		drawing.height = canvas.height;
		drawing.getContext('2d')!.drawImage(canvas, 0, 0);
		history = [
			...history.slice(-(MAX_HISTORY - 1)),
			{ items: cloneItems(items), drawing }
		];
	}

	function restoreCanvasFrom(source: HTMLCanvasElement) {
		if (!ctx || !board) return;
		const r = board.getBoundingClientRect();
		ctx.globalCompositeOperation = 'source-over';
		ctx.clearRect(0, 0, r.width, r.height);
		ctx.drawImage(source, 0, 0, r.width, r.height);
	}

	function undoPage() {
		if (!canUndo) return;
		const entry = history[history.length - 1];
		history = history.slice(0, -1);
		drawing = false;
		eraserCursor = null;
		commitText();
		clearPress();
		boxResize = null;
		boxRotate = null;
		editingId = null;
		selectedId = null;
		items = cloneItems(entry.items);
		restoreCanvasFrom(entry.drawing);
		haptic('selection');
		scheduleSave();
	}

	async function restoreDrawing(blob: Blob) {
		const bmp = await createImageBitmap(blob);
		const r = board.getBoundingClientRect();
		ctx.globalCompositeOperation = 'source-over';
		ctx.clearRect(0, 0, r.width, r.height);
		ctx.drawImage(bmp, 0, 0, r.width, r.height);
		bmp.close();
	}

	onMount(() => {
		ctx = canvas.getContext('2d')!;
		resize();
		window.addEventListener('resize', resize);

		let cancelled = false;
		(async () => {
			try {
				const saved = await loadPage();
				if (cancelled || !saved) return;
				items = saved.items as Item[];
				if (saved.drawing) await restoreDrawing(saved.drawing);
			} catch (err) {
				console.error(err);
			} finally {
				if (!cancelled) ready = true;
			}
		})();

		const onHide = () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			void persistNow();
		};
		window.addEventListener('pagehide', onHide);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') onHide();
		});

		const vv = window.visualViewport;
		const onViewport = () => syncKeyboardShift();
		vv?.addEventListener('resize', onViewport);
		vv?.addEventListener('scroll', onViewport);

		return () => {
			cancelled = true;
			window.removeEventListener('resize', resize);
			window.removeEventListener('pagehide', onHide);
			vv?.removeEventListener('resize', onViewport);
			vv?.removeEventListener('scroll', onViewport);
			if (saveTimer) clearTimeout(saveTimer);
			clearPress();
			void persistNow();
		};
	});

	$effect(() => {
		if (editingId == null || !editor) return;
		editor.focus({ preventScroll: true });
		const len = editor.value.length;
		editor.setSelectionRange(len, len);
		requestAnimationFrame(() => syncKeyboardShift());
	});

	$effect(() => {
		const id = editingId;
		if (id == null) {
			keyboardOffset = 0;
			return;
		}
		const item = items.find((i) => i.id === id);
		if (!item || !isText(item)) {
			keyboardOffset = 0;
			return;
		}
		// Re-run when the box moves or grows while the keyboard is up
		void item.x;
		void item.y;
		void item.w;
		void item.h;
		void item.value;
		syncKeyboardShift();
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

	function isText(item: Item): item is TextItem {
		return item.kind === 'text';
	}

	function isSticker(item: Item): item is StickerItem {
		return item.kind === 'sticker';
	}

	function fitEditorToContent(item: TextItem) {
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
		if (isSticker(item)) return;
		if (item.w == null || item.h == null) {
			const size = defaultTextSize(item.x, item.y);
			item.w ??= size.w;
			item.h ??= size.h;
		}
		item.fontSize ??= BASE_FONT;
	}

	function fontSizeOf(item: TextItem) {
		return item.fontSize ?? BASE_FONT;
	}

	function rotationOf(item: Item) {
		return item.rotation ?? 0;
	}

	function itemCenter(item: Item) {
		const w = item.w ?? MIN_W;
		const h = item.h ?? MIN_H;
		return { cx: item.x + w / 2, cy: item.y + h / 2 };
	}

	function pointerAngle(item: Item, clientX: number, clientY: number) {
		const r = board.getBoundingClientRect();
		const { cx, cy } = itemCenter(item);
		return (Math.atan2(clientY - r.top - cy, clientX - r.left - cx) * 180) / Math.PI;
	}

	function localDelta(dx: number, dy: number, rotation: number) {
		const rad = (-rotation * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
	}

	function placeSticker(src: string) {
		commitText();
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(1, DEFAULT_STICKER / Math.max(img.naturalWidth, img.naturalHeight));
			const w = Math.max(MIN_STICKER, Math.round(img.naturalWidth * scale));
			const h = Math.max(MIN_STICKER, Math.round(img.naturalHeight * scale));
			const x = clamp((board.clientWidth - w) / 2, 0, Math.max(0, board.clientWidth - w));
			const y = clamp((board.clientHeight - h) / 2, 0, Math.max(0, board.clientHeight - h));
			const id = Date.now();
			pushHistory();
			items = [...items, { id, kind: 'sticker', x, y, w, h, src }];
			selectedId = id;
			haptic('light');
			scheduleSave();
		};
		img.onerror = () => haptic('error');
		img.src = src;
	}

	async function startEditing(id: number) {
		const item = items.find((i) => i.id === id);
		// Snapshot before typing so edits to existing text can be undone
		if (item && isText(item) && item.value.trim()) pushHistory();
		selectedId = id;
		editingId = id;
		await tick();
	}

	function pruneEmptyText(exceptId?: number | null) {
		const next = items.filter(
			(i) => !isText(i) || i.value.trim() || i.id === exceptId || i.id === editingId
		);
		if (next.length === items.length) return;
		items = next;
		if (selectedId != null && !items.some((i) => i.id === selectedId)) selectedId = null;
		scheduleSave();
	}

	function deselect() {
		selectedId = null;
		pruneEmptyText();
	}

	function commitText(forId?: number) {
		if (editingId == null || interacting) return;
		if (forId != null && editingId !== forId) return;
		const id = editingId;
		editingId = null;
		keyboardOffset = 0;
		const item = items.find((i) => i.id === id);
		if (!item || !isText(item)) return;
		item.value = item.value.trimEnd();
		if (!item.value.trim()) {
			deleteItem(id);
			return;
		}
		scheduleSave();
	}

	function syncKeyboardShift() {
		if (!board || editingId == null) {
			keyboardOffset = 0;
			return;
		}
		const item = items.find((i) => i.id === editingId);
		if (!item || !isText(item)) {
			keyboardOffset = 0;
			return;
		}
		const vv = window.visualViewport;
		if (!vv) {
			keyboardOffset = 0;
			return;
		}
		const obscured = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
		if (obscured < 12) {
			keyboardOffset = 0;
			return;
		}
		// Undo the current lift so we measure the box's natural place on the page
		const boardRect = board.getBoundingClientRect();
		const naturalTop = boardRect.top + keyboardOffset;
		const itemBottom = naturalTop + item.y + (item.h ?? MIN_H);
		const visibleBottom = vv.offsetTop + vv.height;
		const pad = 28;
		const overflow = itemBottom + pad - visibleBottom;
		keyboardOffset = overflow > 0 ? Math.min(overflow, obscured + 48) : 0;
	}

	function resetTrash() {
		trashOpen = 0;
		overTrash = false;
	}

	function clearPress() {
		if (!press) return;
		press = null;
		movingId = null;
		resetTrash();
	}

	function deleteItem(id: number) {
		items = items.filter((i) => i.id !== id);
		if (editingId === id) editingId = null;
		if (selectedId === id) selectedId = null;
		scheduleSave();
	}

	function clearPage() {
		if (!ready) return;
		commitText();
		clearPress();
		boxResize = null;
		boxRotate = null;
		editingId = null;
		selectedId = null;
		pushHistory();
		items = [];
		if (ctx && board) {
			const r = board.getBoundingClientRect();
			ctx.globalCompositeOperation = 'source-over';
			ctx.clearRect(0, 0, r.width, r.height);
		}
		haptic('error');
		scheduleSave();
	}

	function updateTrashProximity(clientX: number, clientY: number) {
		if (!trashEl || movingId == null) {
			resetTrash();
			return;
		}
		const r = trashEl.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const dist = Math.hypot(clientX - cx, clientY - cy);
		const open = clamp(1 - (dist - TRASH_HIT) / (TRASH_APPROACH - TRASH_HIT), 0, 1);
		trashOpen = open;
		const wasOver = overTrash;
		overTrash = dist <= TRASH_HIT;
		if (overTrash && !wasOver) haptic('medium');
	}

	function moveItemTo(item: Item, clientX: number, clientY: number, ox: number, oy: number) {
		const r = board.getBoundingClientRect();
		const w = item.w ?? MIN_W;
		const h = item.h ?? MIN_H;
		item.x = clamp(clientX - r.left - ox, 0, board.clientWidth - w);
		item.y = clamp(clientY - r.top - oy, 0, board.clientHeight - h);
	}

	function canDragPress() {
		if (!press) return false;
		const { item, wasEditing } = press;
		// Stickers / text only move once already selected (or editing)
		return selectedId === item.id || wasEditing;
	}

	function startDragging() {
		if (!press || press.dragging || !canDragPress()) return;
		press.dragging = true;
		interacting = true;
		movingId = press.item.id;
		pushHistory();
		resetTrash();
		window.getSelection()?.removeAllRanges();
		// Blur so the caret/keyboard don't fight the drag
		if (press.wasEditing) editor?.blur();
	}

	function beginPress(e: PointerEvent, item: Item) {
		e.stopPropagation();
		if (press) clearPress();
		boxResize = null;
		boxRotate = null;
		ensureSize(item);
		const p = pos(e);
		const target = e.currentTarget as HTMLElement;
		const wasEditing = editingId === item.id;
		const hitText =
			isText(item) &&
			(wasEditing || !!(e.target as Element | null)?.closest?.('.text-content'));
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
			wasEditing,
			hitText
		};
	}

	function onPressMove(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		if (!press.dragging) {
			const dx = e.clientX - press.startClientX;
			const dy = e.clientY - press.startClientY;
			if (dx * dx + dy * dy <= MOVE_SLOP * MOVE_SLOP) return;
			startDragging();
			if (!press.dragging) return;
		}
		e.preventDefault();
		moveItemTo(press.item, e.clientX, e.clientY, press.ox, press.oy);
		updateTrashProximity(e.clientX, e.clientY);
	}

	function endPress(e: PointerEvent) {
		if (!press || press.pointerId !== e.pointerId) return;
		const { item, dragging, wasEditing, hitText } = press;
		const dropInTrash = dragging && overTrash;
		press = null;
		movingId = null;
		resetTrash();
		if (dragging) {
			interacting = false;
			if (dropInTrash) {
				deleteItem(item.id);
				haptic('error');
				return;
			}
			haptic('medium');
			scheduleSave();
			if (wasEditing && editingId === item.id) {
				editor?.focus({ preventScroll: true });
				requestAnimationFrame(() => syncKeyboardShift());
			}
			return;
		}
		if (isSticker(item)) {
			commitText();
			pruneEmptyText(item.id);
			selectedId = item.id;
			haptic('light');
			return;
		}
		// Short tap: characters (or empty + already selected) → edit; otherwise just select
		if (!wasEditing) {
			const empty = !item.value.trim();
			const editOnTap = hitText || (empty && selectedId === item.id);
			commitText();
			if (editOnTap) {
				startEditing(item.id);
			} else {
				pruneEmptyText(item.id);
				selectedId = item.id;
			}
			haptic('light');
		}
	}

	function eraserDiameter(pressure = 1) {
		const penWidth = brushSize * pressure;
		return Math.max(brushSize * 3, penWidth * 3);
	}

	const eraserPreviewSize = $derived(eraserDiameter());

	function setEraserCursor(e: PointerEvent) {
		if (tool !== 'draw' || drawMode !== 'eraser') {
			eraserCursor = null;
			return;
		}
		const p = pos(e);
		eraserCursor = { x: p.x, y: p.y };
	}

	function clearEraserCursor() {
		if (!drawing) eraserCursor = null;
	}

	function selectDraw(mode: DrawMode = 'pencil') {
		const changed = tool !== 'draw' || drawMode !== mode;
		tool = 'draw';
		drawMode = mode;
		if (mode !== 'eraser') eraserCursor = null;
		deselect();
		if (changed) haptic('selection');
	}

	function selectText() {
		const changed = tool !== 'text';
		tool = 'text';
		drawMode = 'pencil';
		eraserCursor = null;
		deselect();
		if (changed) haptic('selection');
	}

	function strokeTo(x: number, y: number) {
		const mx = (drawX + x) / 2;
		const my = (drawY + y) / 2;
		ctx.quadraticCurveTo(drawX, drawY, mx, my);
		drawX = x;
		drawY = y;
	}

	function down(e: PointerEvent) {
		const p = pos(e);
		deselect();
		if (tool === 'draw') {
			commitText();
			pushHistory();
			drawing = true;
			canvas.setPointerCapture(e.pointerId);
			const pressure = e.pointerType === 'pen' ? 0.55 + e.pressure * 0.9 : 1;
			const penWidth = brushSize * pressure;
			ctx.lineWidth = drawMode === 'eraser' ? eraserDiameter(pressure) : penWidth;
			ctx.strokeStyle = color;
			ctx.globalCompositeOperation = drawMode === 'eraser' ? 'destination-out' : 'source-over';
			drawX = p.x;
			drawY = p.y;
			if (drawMode === 'eraser') eraserCursor = { x: p.x, y: p.y };
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			// Dot so a tap still leaves a mark
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
		} else if (tool === 'text') {
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
			pushHistory();
			items = [
				...items.filter((i) => !isText(i) || i.value.trim()),
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
			haptic('light');
			startEditing(id);
		}
	}

	function move(e: PointerEvent) {
		if (tool === 'draw' && drawMode === 'eraser') setEraserCursor(e);
		if (!drawing) return;
		const coalesced = e.getCoalescedEvents?.() ?? [];
		const samples = coalesced.length ? coalesced : [e];
		for (const sample of samples) {
			const p = pos(sample);
			strokeTo(p.x, p.y);
		}
		ctx.stroke();
	}

	function up(e?: PointerEvent) {
		if (!drawing) return;
		if (e) {
			const p = pos(e);
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
			if (drawMode === 'eraser') {
				if (e.pointerType === 'mouse') eraserCursor = { x: p.x, y: p.y };
				else eraserCursor = null;
			}
		} else if (drawMode === 'eraser') {
			eraserCursor = null;
		}
		drawing = false;
		ctx.globalCompositeOperation = 'source-over';
		scheduleSave();
	}

	function beginResize(e: PointerEvent, item: Item) {
		e.stopPropagation();
		e.preventDefault();
		clearPress();
		boxRotate = null;
		ensureSize(item);
		interacting = true;
		pushHistory();
		boxResize = {
			item,
			startX: e.clientX,
			startY: e.clientY,
			startW: item.w ?? MIN_W,
			startH: item.h ?? MIN_H,
			startFont: isText(item) ? fontSizeOf(item) : BASE_FONT
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onResizeMove(e: PointerEvent) {
		if (!boxResize) return;
		const { item } = boxResize;
		const { x: dx, y: dy } = localDelta(
			e.clientX - boxResize.startX,
			e.clientY - boxResize.startY,
			rotationOf(item)
		);
		if (isSticker(item)) {
			const aspect = boxResize.startW / Math.max(1, boxResize.startH);
			const maxW = Math.max(MIN_STICKER, board.clientWidth - item.x - 8);
			const maxH = Math.max(MIN_STICKER, board.clientHeight - item.y - 8);
			let w = boxResize.startW + dx;
			let h = boxResize.startH + dy;
			// Prefer the axis with larger movement; keep aspect
			if (Math.abs(dx) * (1 / aspect) >= Math.abs(dy)) {
				h = w / aspect;
			} else {
				w = h * aspect;
			}
			w = clamp(w, MIN_STICKER, maxW);
			h = clamp(w / aspect, MIN_STICKER, maxH);
			w = h * aspect;
			if (w > maxW) {
				w = maxW;
				h = w / aspect;
			}
			item.w = Math.round(w);
			item.h = Math.round(h);
			return;
		}
		const minH = lineHeightPx(MIN_FONT);
		const maxW = Math.max(MIN_W, board.clientWidth - item.x - 8);
		const maxH = Math.max(minH, board.clientHeight - item.y - 8);
		const w = clamp(boxResize.startW + dx, MIN_W, maxW);
		const h = clamp(boxResize.startH + dy, minH, maxH);
		item.w = w;
		item.h = h;
		// Scale type with the box (geometric mean keeps it even when aspect drifts)
		const scale = Math.sqrt((w / boxResize.startW) * (h / boxResize.startH));
		item.fontSize = clamp(boxResize.startFont * scale, MIN_FONT, MAX_FONT);
	}

	function endResize() {
		if (!boxResize) return;
		const id = boxResize.item.id;
		boxResize = null;
		interacting = false;
		scheduleSave();
		if (editingId === id) editor?.focus({ preventScroll: true });
	}

	function beginRotate(e: PointerEvent, item: Item) {
		e.stopPropagation();
		e.preventDefault();
		clearPress();
		boxResize = null;
		ensureSize(item);
		interacting = true;
		pushHistory();
		boxRotate = {
			item,
			startPointerAngle: pointerAngle(item, e.clientX, e.clientY),
			startRotation: rotationOf(item)
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onRotateMove(e: PointerEvent) {
		if (!boxRotate) return;
		const { item, startPointerAngle, startRotation } = boxRotate;
		const delta = pointerAngle(item, e.clientX, e.clientY) - startPointerAngle;
		item.rotation = ((startRotation + delta) % 360 + 360) % 360;
	}

	function endRotate() {
		if (!boxRotate) return;
		const id = boxRotate.item.id;
		boxRotate = null;
		interacting = false;
		scheduleSave();
		if (editingId === id) editor?.focus({ preventScroll: true });
	}

	function onEditorBlur(id: number) {
		// Delay so resize/move/rotate can set interacting / restore focus first
		requestAnimationFrame(() => {
			if (interacting || press?.dragging || boxResize || boxRotate) return;
			if (editingId === id && document.activeElement !== editor) {
				commitText(id);
				// The same tap that blurred often lands on the board — don't treat it as "add new"
				skipNextTextCreate = true;
			}
		});
	}

	function onEditorKeydown(e: KeyboardEvent, item: TextItem) {
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

	function onEditorInput(item: TextItem) {
		fitEditorToContent(item);
	}

	function onEditorPointerDown(e: PointerEvent, item: TextItem) {
		// Tap places the caret; sliding past the slop drags the box
		beginPress(e, item);
	}
</script>

<div class="page">
	<div
		class="board"
		class:lifted={keyboardOffset > 0}
		bind:this={board}
		style:transform={keyboardOffset > 0 ? `translateY(${-keyboardOffset}px)` : undefined}
	>
		<canvas
			bind:this={canvas}
			class:eraser={tool === 'draw' && drawMode === 'eraser'}
			style:pointer-events={ready ? 'auto' : 'none'}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onpointerenter={setEraserCursor}
			onpointerleave={clearEraserCursor}
		></canvas>
		{#if eraserCursor && tool === 'draw' && drawMode === 'eraser'}
			<div
				class="eraser-cursor"
				style:left="{eraserCursor.x}px"
				style:top="{eraserCursor.y}px"
				style:width="{eraserPreviewSize}px"
				style:height="{eraserPreviewSize}px"
				aria-hidden="true"
			></div>
		{/if}
		<div class="board-actions">
			<button
				type="button"
				class="board-action"
				aria-label="Undo"
				disabled={!canUndo}
				onclick={undoPage}
			>
				Undo
			</button>
			<button
				type="button"
				class="board-action"
				aria-label="Clear page"
				disabled={!ready}
				onclick={clearPage}
			>
				Clear
			</button>
		</div>
		<div
			bind:this={trashEl}
			class="trash"
			class:visible={movingId != null}
			class:hot={overTrash}
			style:--lid={trashOpen}
			aria-hidden="true"
		>
			<svg class="trash-icon" viewBox="0 0 48 56" fill="none" aria-hidden="true">
				<g class="trash-lid">
					<path
						class="trash-lid-top"
						d="M14 18h20l-1.2-3.6a3 3 0 0 0-2.8-2.1h-4.4c-.4-1.5-1.7-2.3-3.1-2.3s-2.7.8-3.1 2.3h-4.4a3 3 0 0 0-2.8 2.1L14 18Z"
						fill="currentColor"
					/>
					<rect class="trash-lid-lip" x="10" y="18" width="28" height="3.5" rx="1.2" fill="currentColor" />
				</g>
				<path
					class="trash-can"
					d="M15.5 24.5h17l-1.2 24.2a3.5 3.5 0 0 1-3.5 3.3h-7.6a3.5 3.5 0 0 1-3.5-3.3L15.5 24.5Z"
					fill="currentColor"
				/>
				<path
					class="trash-lines"
					d="M20 29.5v16M24 29.5v16M28 29.5v16"
					stroke="var(--surface)"
					stroke-width="2.2"
					stroke-linecap="round"
				/>
			</svg>
		</div>
		{#each items as item (item.id)}
			{#if isSticker(item)}
				<div
					class="sticker-item"
					class:selected={selectedId === item.id}
					class:moving={movingId === item.id}
					class:trashing={movingId === item.id && overTrash}
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width="{item.w}px"
					style:height="{item.h}px"
					style:--rot="{rotationOf(item)}deg"
					role="group"
					aria-label="Sticker"
					onpointerdown={(e) => beginPress(e, item)}
					onpointermove={onPressMove}
					onpointerup={endPress}
					onpointercancel={endPress}
				>
					<img src={item.src} alt="" draggable="false" />
					{#if selectedId === item.id}
						<button
							type="button"
							class="rotate-handle"
							aria-label="Rotate sticker"
							onpointerdown={(e) => beginRotate(e, item)}
							onpointermove={onRotateMove}
							onpointerup={endRotate}
							onpointercancel={endRotate}
						>
							<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<path
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3L13.2 5.5"
								/>
								<path
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.2 2.3v3.2h-3.2"
								/>
							</svg>
						</button>
						<button
							type="button"
							class="resize-handle"
							aria-label="Resize sticker"
							onpointerdown={(e) => beginResize(e, item)}
							onpointermove={onResizeMove}
							onpointerup={endResize}
							onpointercancel={endResize}
						></button>
					{/if}
				</div>
			{:else if editingId === item.id}
				<div
					class="text-box editing"
					class:moving={movingId === item.id}
					class:trashing={movingId === item.id && overTrash}
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width="{item.w}px"
					style:height="{item.h}px"
					style:font-size="{fontSizeOf(item)}px"
					style:color={item.color ?? color}
					style:--rot="{rotationOf(item)}deg"
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
						class="rotate-handle"
						aria-label="Rotate text box"
						onpointerdown={(e) => beginRotate(e, item)}
						onpointermove={onRotateMove}
						onpointerup={endRotate}
						onpointercancel={endRotate}
					>
						<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3L13.2 5.5"
							/>
							<path
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.2 2.3v3.2h-3.2"
							/>
						</svg>
					</button>
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
					class:selected={selectedId === item.id}
					class:moving={movingId === item.id}
					class:trashing={movingId === item.id && overTrash}
					style:left="{item.x}px"
					style:top="{item.y}px"
					style:width={item.w ? `${item.w}px` : undefined}
					style:height={item.h ? `${item.h}px` : undefined}
					style:font-size="{fontSizeOf(item)}px"
					style:color={item.color ?? color}
					style:--rot="{rotationOf(item)}deg"
					onpointerdown={(e) => beginPress(e, item)}
					onpointermove={onPressMove}
					onpointerup={endPress}
					onpointercancel={endPress}
					role="presentation"
				>
					<span class="text-content">{item.value}</span>
					{#if selectedId === item.id}
						<button
							type="button"
							class="rotate-handle"
							aria-label="Rotate text box"
							onpointerdown={(e) => beginRotate(e, item)}
							onpointermove={onRotateMove}
							onpointerup={endRotate}
							onpointercancel={endRotate}
						>
							<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<path
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3L13.2 5.5"
								/>
								<path
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.2 2.3v3.2h-3.2"
								/>
							</svg>
						</button>
						<button
							type="button"
							class="resize-handle"
							aria-label="Resize text box"
							onpointerdown={(e) => beginResize(e, item)}
							onpointermove={onResizeMove}
							onpointerup={endResize}
							onpointercancel={endResize}
						></button>
					{/if}
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
		<StickerSheet onPick={placeSticker} />
		<div class="end-tools">
			{#if tool === 'draw'}
				<SizePicker bind:size={brushSize} />
			{/if}
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
		display: grid;
		grid-template-columns: auto 0fr;
		align-items: center;
		height: 2.6rem;
		padding: 0.15rem;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: 0 1px 4px oklch(0.3 0.02 52 / 0.1);
		transition: grid-template-columns 220ms var(--ease-out-quint);

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
		}
	}
	.eraser-slot {
		display: grid;
		min-width: 0;
		overflow: hidden;
		opacity: 0;
		transform: translateX(-0.55rem) scale(0.92);
		transform-origin: left center;
		pointer-events: none;
		transition:
			opacity 180ms var(--ease-out),
			transform 220ms var(--ease-out);

		&.open {
			opacity: 1;
			transform: none;
			pointer-events: auto;
		}

		.tool {
			margin-inline-start: 0.1rem;
		}
	}
	.end-tools {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}
	.tool {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		padding: 0;
		transition:
			background-color var(--duration-press) ease,
			color var(--duration-press) ease,
			transform var(--duration-press) ease-out;

		&:active {
			transform: scale(0.96);
		}

		&.active {
			background: var(--accent);
			color: var(--surface);
		}

		svg {
			width: 1.25rem;
			height: 1.25rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.draw-pill,
		.tool,
		.eraser-slot,
		.resize-handle,
		.rotate-handle,
		.board-action,
		.trash,
		.trash-lid,
		.trash-icon,
		.sticker-item,
		.text-box {
			transition: none;
			animation: none;
		}

		.resize-handle,
		.rotate-handle {
			opacity: 1;
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

		&.lifted {
			z-index: 2;
		}
	}
	.board-actions {
		position: absolute;
		top: 0.85rem;
		right: 0.85rem;
		z-index: 30;
		display: flex;
		gap: 0.4rem;
	}
	.board-action {
		height: 2.4rem;
		padding: 0 0.95rem;
		font-size: 0.95rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		color: var(--ink);
		background: oklch(0.92 0.015 82 / 0.92);
		box-shadow: 0 2px 10px oklch(0.3 0.02 52 / 0.12);
		transition:
			transform var(--duration-press) ease-out,
			background-color 160ms ease,
			opacity 160ms ease;

		&:active:not(:disabled) {
			transform: scale(0.96);
		}

		&:disabled {
			opacity: 0.45;
		}
	}
	.trash {
		position: absolute;
		top: 0.85rem;
		left: 0.85rem;
		z-index: 30;
		display: grid;
		place-items: center;
		width: 3.75rem;
		height: 3.75rem;
		border-radius: 999px;
		color: var(--ink);
		background: oklch(0.92 0.015 82 / 0.92);
		box-shadow: 0 2px 10px oklch(0.3 0.02 52 / 0.12);
		opacity: 0;
		transform: scale(0.55);
		pointer-events: none;
		transition:
			opacity 180ms var(--ease-out),
			transform 220ms var(--ease-out-quint),
			background-color 160ms ease,
			color 160ms ease,
			box-shadow 160ms ease;

		&.visible {
			opacity: 1;
			transform: scale(calc(0.9 + var(--lid, 0) * 0.22));
		}

		&.hot {
			color: var(--surface);
			background: oklch(0.48 0.12 28);
			box-shadow: 0 4px 16px oklch(0.4 0.1 28 / 0.28);
			transform: scale(1.16);
		}
	}
	.trash-icon {
		width: 2.05rem;
		height: auto;
		overflow: visible;
		transform-origin: 50% 70%;
		transition: transform 160ms var(--ease-out);
	}
	.trash.hot .trash-icon {
		transform: scale(1.06);
	}
	.trash-lid {
		transform-box: view-box;
		transform-origin: 14px 20px;
		transform: rotate(calc(var(--lid, 0) * -52deg));
		transition: transform 80ms linear;
	}
	.trash.hot .trash-lid {
		transform: rotate(-62deg);
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;

		&.eraser {
			cursor: none;
		}
	}
	.eraser-cursor {
		position: absolute;
		z-index: 4;
		box-sizing: border-box;
		border: 1.5px solid oklch(0.3 0.02 52 / 0.55);
		border-radius: 50%;
		background: oklch(1 0 0 / 0.45);
		box-shadow: 0 0 0 1px oklch(1 0 0 / 0.5);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.sticker-item {
		--rot: 0deg;
		position: absolute;
		box-sizing: border-box;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		overflow: visible;
		transform: rotate(var(--rot));
		transform-origin: center center;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
			pointer-events: none;
			-webkit-user-drag: none;
		}

		&.moving {
			opacity: 0.92;
			cursor: grabbing;
			transition:
				opacity 140ms ease,
				transform 140ms var(--ease-out);
		}

		&.trashing {
			opacity: 0.35;
			transform: rotate(var(--rot)) scale(0.45);
		}

		&.selected {
			box-shadow: 0 0 0 2px var(--select);
			border-radius: 0.25rem;
		}
	}
	.text-box {
		--rot: 0deg;
		position: absolute;
		box-sizing: border-box;
		padding: 0;
		border: 0;
		border-radius: 0.35rem;
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
		transform: rotate(var(--rot));
		transform-origin: center center;

		// Ring via box-shadow so it doesn't shift the text
		&.empty {
			box-shadow: 0 0 0 2px color-mix(in oklch, var(--select) 45%, transparent);
		}

		&.selected {
			overflow: visible;
			box-shadow: 0 0 0 2px var(--select);
		}

		&.moving {
			opacity: 0.92;
			cursor: grabbing;
			transition:
				opacity 140ms ease,
				transform 140ms var(--ease-out);
		}

		&.trashing {
			opacity: 0.35;
			transform: rotate(var(--rot)) scale(0.45);
		}

		&.editing {
			overflow: visible;
			background: transparent;
			box-shadow: 0 0 0 2px var(--select);
			touch-action: none;
			user-select: text;
		}
	}
	.text-content {
		display: block;
		width: fit-content;
		max-width: 100%;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		pointer-events: auto;
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
		opacity: 0;
		animation: handle-in 180ms var(--ease-out) forwards;
		transition: transform var(--duration-press) ease-out;

		&:active {
			transform: scale(0.96);
		}

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

	.rotate-handle {
		position: absolute;
		right: -0.45rem;
		top: -1.75rem;
		display: grid;
		place-items: center;
		width: 1.15rem;
		height: 1.15rem;
		padding: 0;
		border: 2px solid var(--select);
		border-radius: 999px;
		color: var(--select);
		background: var(--surface);
		box-shadow: none;
		touch-action: none;
		cursor: grab;
		opacity: 0;
		animation: handle-in 180ms var(--ease-out) forwards;
		transition: transform var(--duration-press) ease-out;

		svg {
			width: 0.7rem;
			height: 0.7rem;
			pointer-events: none;
		}

		&:active {
			cursor: grabbing;
			transform: scale(0.96);
		}

		// Stem hook from the top-right corner up into the knob
		&::before {
			content: '';
			position: absolute;
			left: 50%;
			top: 100%;
			width: 2px;
			height: 0.7rem;
			margin-left: -1px;
			background: var(--select);
			pointer-events: none;
		}
	}

	@keyframes handle-in {
		to {
			opacity: 1;
		}
	}
</style>
