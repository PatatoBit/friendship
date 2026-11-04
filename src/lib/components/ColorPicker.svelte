<script lang="ts">
	let {
		color = $bindable('#3a2e2a'),
		presets = ['#3a2e2a', '#ff7aa2', '#6bb5ff', '#7bd389', '#ffc94d', '#ffffff', '#c084fc', '#fb7185']
	}: { color?: string; presets?: string[] } = $props();

	let open = $state(false);
	let hue = $state(20);
	let sat = $state(40);
	let val = $state(23);
	let wheelEl: HTMLDivElement;

	$effect(() => {
		const hsv = hexToHsv(color);
		if (!hsv) return;
		hue = hsv.h;
		sat = hsv.s;
		val = hsv.v;
	});

	function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
		const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
		if (!m) return null;
		const r = parseInt(m[1], 16) / 255;
		const g = parseInt(m[2], 16) / 255;
		const b = parseInt(m[3], 16) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0;
		if (d) {
			if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
			else if (max === g) h = ((b - r) / d + 2) * 60;
			else h = ((r - g) / d + 4) * 60;
		}
		return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
	}

	function hsvToHex(h: number, s: number, v: number) {
		s /= 100;
		v /= 100;
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let r = 0,
			g = 0,
			b = 0;
		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		const to = (n: number) =>
			Math.round((n + m) * 255)
				.toString(16)
				.padStart(2, '0');
		return `#${to(r)}${to(g)}${to(b)}`;
	}

	function applyHsv(h: number, s: number, v: number) {
		hue = h;
		sat = s;
		val = v;
		color = hsvToHex(h, s, v);
	}

	function pickWheel(e: PointerEvent) {
		const r = wheelEl.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const dx = e.clientX - cx;
		const dy = e.clientY - cy;
		const radius = Math.max(r.width / 2, 1);
		const dist = Math.min(Math.hypot(dx, dy) / radius, 1);
		// 0° at top, clockwise — matches CSS conic-gradient
		let h = (Math.atan2(dx, -dy) * 180) / Math.PI;
		if (h < 0) h += 360;
		applyHsv(h, dist * 100, val);
	}

	function wheelDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pickWheel(e);
	}

	function selectPreset(c: string) {
		color = c;
		const hsv = hexToHsv(c);
		if (hsv) {
			hue = hsv.h;
			sat = hsv.s;
			val = hsv.v;
		}
	}

	function close() {
		open = false;
	}

	const thumbX = $derived(50 + Math.sin((hue * Math.PI) / 180) * (sat / 2));
	const thumbY = $derived(50 - Math.cos((hue * Math.PI) / 180) * (sat / 2));
</script>

<div class="picker">
	<button
		type="button"
		class="trigger"
		style:background={color}
		aria-label="Choose color"
		aria-expanded={open}
		onclick={() => (open = !open)}
	></button>

	{#if open}
		<button type="button" class="backdrop" aria-label="Close color picker" onclick={close}></button>
		<div class="popover" role="dialog" aria-label="Color picker">
			<div
				class="wheel"
				bind:this={wheelEl}
				style:--v={val / 100}
				onpointerdown={wheelDown}
				onpointermove={(e) => e.buttons && pickWheel(e)}
				role="slider"
				aria-valuetext={color}
				aria-label="Color wheel"
				tabindex="0"
			>
				<span class="thumb" style:left="{thumbX}%" style:top="{thumbY}%" style:background={color}></span>
			</div>

			<label class="brightness">
				<span>Brightness</span>
				<input
					type="range"
					min="8"
					max="100"
					value={val}
					oninput={(e) => applyHsv(hue, sat, +e.currentTarget.value)}
				/>
			</label>

			<div class="presets">
				{#each presets as c}
					<button
						type="button"
						class="preset"
						class:active={color.toLowerCase() === c.toLowerCase()}
						style:background={c}
						aria-label={c}
						onclick={() => selectPreset(c)}
					></button>
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
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: 2px solid white;
		box-shadow:
			0 0 0 1.5px rgba(58, 46, 42, 0.25),
			0 1px 4px rgba(0, 0, 0, 0.12);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		padding: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}
	.popover {
		position: absolute;
		bottom: calc(100% + 0.6rem);
		right: 0;
		left: auto;
		z-index: 21;
		width: min(16.5rem, calc(100vw - 1.5rem));
		padding: 0.9rem;
		background: #fff8ef;
		border-radius: 1.1rem;
		box-shadow: 0 8px 28px rgba(58, 46, 42, 0.18);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.wheel {
		position: relative;
		aspect-ratio: 1;
		width: 100%;
		border-radius: 50%;
		touch-action: none;
		cursor: crosshair;
		background:
			linear-gradient(
				rgba(0, 0, 0, calc(1 - var(--v))),
				rgba(0, 0, 0, calc(1 - var(--v)))
			),
			radial-gradient(circle closest-side, #fff, transparent 70%),
			conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
		box-shadow: inset 0 0 0 1px rgba(58, 46, 42, 0.08);
	}
	.thumb {
		position: absolute;
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(58, 46, 42, 0.35), 0 1px 4px rgba(0, 0, 0, 0.2);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.brightness {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: #3a2e2a;
		span { opacity: 0.7; }
		input[type='range'] {
			width: 100%;
			accent-color: #ff7aa2;
		}
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		justify-content: center;
	}
	.preset {
		width: 1.85rem;
		height: 1.85rem;
		padding: 0;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(58, 46, 42, 0.15);
		&.active {
			outline: 2px solid #ff7aa2;
			outline-offset: 1px;
		}
	}
</style>
