<script lang="ts">
	import { haptic } from '#lib/haptics.ts';

	const DEFAULT_SIZES = [2, 4, 8, 14, 22];

	let {
		size = $bindable(4),
		sizes = DEFAULT_SIZES
	}: { size?: number; sizes?: number[] } = $props();

	let open = $state(false);
	let rendered = $state(false);

	function selectSize(n: number) {
		const changed = size !== n;
		size = n;
		if (changed) haptic('selection');
		hide();
	}

	function show() {
		haptic('medium');
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
		else show();
	}

	function onPopoverTransitionEnd(e: TransitionEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.propertyName !== 'opacity') return;
		if (!open) rendered = false;
	}

	const preview = $derived(Math.min(18, Math.max(4, size * 1.1)));
</script>

<div class="picker">
	<button
		type="button"
		class="trigger"
		aria-label="Brush size {size}"
		aria-expanded={open}
		onclick={toggle}
	>
		<span class="dot" style:width="{preview}px" style:height="{preview}px"></span>
	</button>

	{#if rendered}
		<button
			type="button"
			class="backdrop"
			data-open={open ? '' : undefined}
			aria-label="Close size picker"
			onclick={hide}
		></button>
		<div
			class="popover"
			data-open={open ? '' : undefined}
			role="dialog"
			aria-label="Brush size"
			ontransitionend={onPopoverTransitionEnd}
		>
			<div class="sizes" role="listbox" aria-label="Sizes">
				{#each sizes as n}
					<button
						type="button"
						class="size"
						class:active={size === n}
						role="option"
						aria-selected={size === n}
						aria-label="Size {n}"
						onclick={() => selectSize(n)}
					>
						<span class="dot" style:width="{Math.min(22, Math.max(4, n * 1.15))}px" style:height="{Math.min(22, Math.max(4, n * 1.15))}px"></span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style lang="scss">
	.picker {
		position: relative;
		flex-shrink: 0;
	}
	.trigger {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: 2px solid var(--surface);
		background: var(--surface);
		box-shadow:
			0 0 0 1.5px oklch(0.3 0.02 52 / 0.25),
			0 1px 4px oklch(0.3 0.02 52 / 0.1);
		transition: transform var(--duration-press) ease-out;

		&:active {
			transform: scale(0.96);
		}
	}
	.dot {
		display: block;
		border-radius: 50%;
		background: var(--ink);
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
	}
	.popover {
		position: absolute;
		bottom: calc(100% + 0.6rem);
		right: 0;
		left: auto;
		z-index: var(--z-popover);
		padding: 0.55rem;
		background: var(--paper);
		border-radius: 1.1rem;
		box-shadow: 0 8px 28px oklch(0.3 0.02 52 / 0.16);
		transform-origin: bottom right;
		opacity: 0;
		transform: scale(0.95) translateY(6px);
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
	.backdrop:not([data-open]) {
		transition-duration: var(--duration-exit);
	}
	.sizes {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.size {
		display: grid;
		place-items: center;
		width: 2.35rem;
		height: 2.35rem;
		padding: 0;
		background: var(--surface);
		box-shadow: 0 0 0 1px oklch(0.3 0.02 52 / 0.12);
		transition:
			transform var(--duration-press) ease-out,
			box-shadow var(--duration-press) ease,
			background-color var(--duration-press) ease;

		&.active {
			background: color-mix(in oklch, var(--accent) 12%, var(--surface));
			box-shadow:
				0 0 0 1px oklch(0.3 0.02 52 / 0.12),
				0 0 0 3px var(--surface),
				0 0 0 5px var(--accent);
		}

		&:active {
			transform: scale(0.96);
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.size:hover:not(:active) {
			transform: scale(1.06);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.trigger,
		.backdrop,
		.popover,
		.size {
			transition: none;
		}
	}
</style>
