<script lang="ts">
	import { onDestroy } from 'svelte';
	import { haptic } from '#lib/haptics.ts';
	import { createSticker } from '#lib/stickers/createSticker.ts';
	import {
		addSticker,
		blobToDataUrl,
		loadStickers,
		removeSticker
	} from '#lib/stickers/library.ts';
	import { bitmapToPngBlob, loadImage } from '#lib/stickers/loadImage.ts';

	type SheetSticker = {
		id: string;
		src: string;
		createdAt: number;
	};

	type AddMode = 'sticker' | 'image';

	let { onPick }: { onPick: (src: string) => void } = $props();

	let open = $state(false);
	let rendered = $state(false);
	let stickers = $state<SheetSticker[]>([]);
	let busy = $state(false);
	let previewUrl = $state<string | null>(null);
	let error = $state<string | null>(null);
	let addMode = $state<AddMode>('sticker');
	let fileInput: HTMLInputElement | undefined = $state();

	function clearPreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}

	function revokeSheetUrls(list: SheetSticker[]) {
		for (const s of list) URL.revokeObjectURL(s.src);
	}

	async function refreshStickers() {
		const saved = await loadStickers();
		const prev = stickers;
		stickers = saved.map((s) => ({
			id: s.id,
			src: URL.createObjectURL(s.blob),
			createdAt: s.createdAt
		}));
		revokeSheetUrls(prev);
	}

	async function show() {
		haptic('medium');
		error = null;
		try {
			await refreshStickers();
		} catch (err) {
			console.error(err);
			error = 'Couldn’t load saved stickers.';
		}
		if (rendered) {
			open = true;
			return;
		}
		rendered = true;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (rendered) open = true;
			});
		});
	}

	function hide() {
		if (!open) {
			rendered = false;
			return;
		}
		open = false;
		haptic('light');
		if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
			rendered = false;
		}
	}

	function toggle() {
		if (open) hide();
		else void show();
	}

	function setAddMode(mode: AddMode) {
		if (addMode === mode || busy) return;
		addMode = mode;
		haptic('selection');
		error = null;
	}

	function onPopoverTransitionEnd(e: TransitionEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.propertyName !== 'opacity') return;
		if (!open) rendered = false;
	}

	async function pick(sticker: SheetSticker) {
		haptic('selection');
		try {
			const res = await fetch(sticker.src);
			const dataUrl = await blobToDataUrl(await res.blob());
			onPick(dataUrl);
			hide();
		} catch (err) {
			console.error(err);
			error = 'Couldn’t add that sticker.';
			haptic('error');
		}
	}

	async function remove(sticker: SheetSticker, e: MouseEvent) {
		e.stopPropagation();
		if (busy) return;
		haptic('medium');
		error = null;
		const prev = stickers;
		stickers = stickers.filter((s) => s.id !== sticker.id);
		try {
			await removeSticker(sticker.id);
			URL.revokeObjectURL(sticker.src);
			haptic('success');
		} catch (err) {
			console.error(err);
			stickers = prev;
			error = 'Couldn’t delete that sticker.';
			haptic('error');
		}
	}

	function openFilePicker() {
		if (busy) return;
		haptic('selection');
		fileInput?.click();
	}

	async function prepareImage(file: Blob): Promise<Blob> {
		const bitmap = await loadImage(file);
		try {
			return await bitmapToPngBlob(bitmap);
		} finally {
			bitmap.close();
		}
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !file.type.startsWith('image/')) return;

		const mode = addMode;
		clearPreview();
		previewUrl = URL.createObjectURL(file);
		busy = true;
		error = null;
		try {
			const png = mode === 'sticker' ? await createSticker(file) : await prepareImage(file);
			const saved = await addSticker(png);
			const sheetItem: SheetSticker = {
				id: saved.id,
				src: URL.createObjectURL(saved.blob),
				createdAt: saved.createdAt
			};
			stickers = [sheetItem, ...stickers.filter((s) => s.id !== saved.id)];
			haptic('success');
		} catch (err) {
			console.error(err);
			error =
				err instanceof Error && /quota/i.test(err.message)
					? 'Storage full — remove some stickers and try again.'
					: mode === 'sticker'
						? 'Couldn’t make that sticker. Try another photo.'
						: 'Couldn’t add that image. Try another photo.';
			haptic('error');
		} finally {
			busy = false;
			clearPreview();
		}
	}

	onDestroy(() => {
		clearPreview();
		revokeSheetUrls(stickers);
	});
</script>

<div class="sheet">
	<button
		type="button"
		class="tool"
		class:active={open}
		aria-label="Stickers"
		aria-expanded={open}
		onclick={toggle}
	>
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"
			/>
			<path
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M14 3v5a1 1 0 0 0 1 1h5"
			/>
			<circle cx="9" cy="12" r="1.15" fill="currentColor" />
			<circle cx="15" cy="12" r="1.15" fill="currentColor" />
			<path
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				d="M9 15.75c.75.9 1.75 1.35 3 1.35s2.25-.45 3-1.35"
			/>
		</svg>
	</button>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		class="file"
		aria-hidden="true"
		tabindex="-1"
		onchange={onFileChange}
	/>

	{#if rendered}
		<button
			type="button"
			class="backdrop"
			data-open={open ? '' : undefined}
			aria-label="Close stickers"
			onclick={hide}
		></button>
		<div
			class="popover"
			data-open={open ? '' : undefined}
			role="dialog"
			aria-label="Sticker sheet"
			ontransitionend={onPopoverTransitionEnd}
		>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<div class="grid">
				<div class="cell add">
					<div class="mode" role="group" aria-label="Add as">
						<button
							type="button"
							class="mode-btn"
							aria-pressed={addMode === 'sticker'}
							disabled={busy}
							onclick={() => setAddMode('sticker')}
						>
							Sticker
						</button>
						<button
							type="button"
							class="mode-btn"
							aria-pressed={addMode === 'image'}
							disabled={busy}
							onclick={() => setAddMode('image')}
						>
							Image
						</button>
					</div>
					<button
						type="button"
						class="upload"
						aria-label={addMode === 'sticker' ? 'Upload sticker photo' : 'Upload image'}
						disabled={busy}
						onclick={openFilePicker}
					>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 5v14M5 12h14"
							/>
						</svg>
						<span>Add</span>
					</button>
				</div>

				{#if busy && previewUrl}
					<div class="cell processing" aria-live="polite" aria-busy="true">
						<img src={previewUrl} alt="" draggable="false" />
						<div class="overlay">
							<span>{addMode === 'sticker' ? 'Making sticker…' : 'Adding image…'}</span>
						</div>
					</div>
				{/if}

				{#each stickers as sticker (sticker.id)}
					<div class="cell sticker">
						<button
							type="button"
							class="pick"
							aria-label="Add sticker"
							onclick={() => pick(sticker)}
						>
							<img src={sticker.src} alt="" draggable="false" />
						</button>
						<button
							type="button"
							class="remove"
							aria-label="Delete sticker"
							disabled={busy}
							onclick={(e) => remove(sticker, e)}
						>
							<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									d="M7 7l10 10M17 7L7 17"
								/>
							</svg>
						</button>
					</div>
				{/each}
			</div>

			{#if !stickers.length && !busy}
				<p class="empty">
					{addMode === 'sticker'
						? 'Upload a photo to cut a sticker.'
						: 'Upload a photo to add as an image.'}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.sheet {
		position: relative;
		flex-shrink: 0;
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

	.file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
		padding: 0;
		border-radius: 0;
		background: oklch(0.3 0.02 52 / 0.12);
		box-shadow: none;
		opacity: 0;
		transition: opacity var(--duration-ui) var(--ease-out);

		&[data-open] {
			opacity: 1;
		}

		&:not([data-open]) {
			transition-duration: var(--duration-exit);
		}
	}

	.popover {
		position: fixed;
		left: 0.75rem;
		right: 0.75rem;
		bottom: calc(3.6rem + env(safe-area-inset-bottom, 0px));
		z-index: var(--z-popover);
		width: auto;
		max-height: min(26rem, calc(100dvh - 6.5rem));
		padding: 0.75rem;
		background: var(--paper);
		border-radius: 1rem;
		box-shadow: 0 8px 28px oklch(0.3 0.02 52 / 0.16);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		transform-origin: bottom center;
		opacity: 0;
		transform: scale(0.97) translateY(8px);
		transition:
			opacity var(--duration-ui) var(--ease-out),
			transform var(--duration-ui) var(--ease-out);

		&[data-open] {
			opacity: 1;
			transform: scale(1) translateY(0);
		}

		&:not([data-open]) {
			transition-duration: var(--duration-exit);
		}
	}

	.error {
		margin: 0;
		padding: 0.5rem 0.65rem;
		border-radius: 0.6rem;
		background: oklch(0.72 0.12 25 / 0.18);
		color: oklch(0.42 0.12 25);
		font-size: 0.8rem;
		line-height: 1.3;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.45rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		max-height: min(18rem, calc(100dvh - 11rem));
		padding: 0.05rem;
	}

	.cell {
		aspect-ratio: 1;
		padding: 0;
		border-radius: 0.65rem;
		box-shadow: none;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
		transition: transform var(--duration-press) ease-out;

		&:active:not(:disabled) {
			transform: scale(0.96);
		}

		&:disabled {
			opacity: 0.55;
		}
	}

	.processing {
		position: relative;
		background: var(--surface);
		pointer-events: none;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		.overlay {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			padding: 0.35rem;
			background: oklch(0.18 0.02 52 / 0.68);
			color: var(--surface);
			text-align: center;

			span {
				font-size: 0.62rem;
				font-weight: 700;
				line-height: 1.2;
				letter-spacing: 0.01em;
			}
		}
	}

	.add {
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 0.2rem;
		padding: 0.3rem;
		background: color-mix(in oklch, var(--surface) 70%, var(--ink) 6%);
		color: var(--ink);
		border: 1.5px dashed color-mix(in oklch, var(--ink) 22%, transparent);

		&:active {
			transform: none;
		}
	}

	.mode {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.15rem;
		padding: 0.12rem;
		border-radius: 0.45rem;
		background: color-mix(in oklch, var(--ink) 6%, transparent);
	}

	.mode-btn {
		min-width: 0;
		padding: 0.28rem 0.15rem;
		border-radius: 0.35rem;
		border: none;
		background: transparent;
		box-shadow: none;
		color: color-mix(in oklch, var(--ink) 62%, transparent);
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		line-height: 1;
		transition:
			background-color var(--duration-press) ease,
			color var(--duration-press) ease;

		&[aria-pressed='true'] {
			background: var(--paper);
			color: var(--ink);
			box-shadow: 0 1px 2px oklch(0.3 0.02 52 / 0.1);
		}

		&:disabled {
			opacity: 0.55;
		}

		&:active:not(:disabled) {
			transform: scale(0.97);
		}
	}

	.upload {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		min-height: 0;
		width: 100%;
		padding: 0;
		border: none;
		border-radius: 0.4rem;
		background: transparent;
		box-shadow: none;
		color: inherit;
		transition: transform var(--duration-press) ease-out;

		&:active:not(:disabled) {
			transform: scale(0.96);
		}

		&:disabled {
			opacity: 0.55;
		}

		svg {
			width: 1.25rem;
			height: 1.25rem;
		}

		span {
			font-size: 0.68rem;
			font-weight: 700;
			line-height: 1;
		}
	}

	.sticker {
		position: relative;
		background:
			linear-gradient(45deg, oklch(0.9 0.01 82) 25%, transparent 25%) 0 0 / 8px 8px,
			linear-gradient(-45deg, oklch(0.9 0.01 82) 25%, transparent 25%) 0 4px / 8px 8px,
			linear-gradient(45deg, transparent 75%, oklch(0.9 0.01 82) 75%) 4px -4px / 8px 8px,
			linear-gradient(-45deg, transparent 75%, oklch(0.9 0.01 82) 75%) -4px 0 / 8px 8px,
			var(--surface);

		&:active {
			transform: none;
		}
	}

	.pick {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		border-radius: inherit;
		background: transparent;
		box-shadow: none;
		transition: transform var(--duration-press) ease-out;

		&:active {
			transform: scale(0.96);
		}

		img {
			width: 100%;
			height: 100%;
			object-fit: contain;
			pointer-events: none;
		}
	}

	.remove {
		position: absolute;
		top: 0.2rem;
		right: 0.2rem;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 1.45rem;
		height: 1.45rem;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: oklch(0.22 0.02 52 / 0.72);
		box-shadow: 0 1px 3px oklch(0.2 0.02 52 / 0.28);
		color: var(--surface);
		transition:
			background-color var(--duration-press) ease,
			transform var(--duration-press) ease-out;

		&:active:not(:disabled) {
			transform: scale(0.92);
			background: oklch(0.18 0.02 52 / 0.85);
		}

		&:disabled {
			opacity: 0.45;
		}

		svg {
			width: 0.72rem;
			height: 0.72rem;
		}
	}

	.empty {
		margin: 0;
		padding: 0 0.15rem;
		font-size: 0.8rem;
		opacity: 0.65;
		line-height: 1.35;
	}

	@media (prefers-reduced-motion: reduce) {
		.tool,
		.backdrop,
		.popover,
		.cell,
		.pick,
		.remove,
		.mode-btn {
			transition: none;
		}
	}
</style>
