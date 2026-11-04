import { canvasToPngBlob } from './loadImage';

export type OutlineOptions = {
	width?: number;
	color?: string;
};

/**
 * Grow the alpha silhouette by `width` px, fill with outline color, then draw the
 * cutout on top — Instagram-style sticker border.
 */
export async function addOutline(
	source: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
	options: OutlineOptions = {}
): Promise<Blob> {
	const outlineWidth = Math.max(1, Math.round(options.width ?? 8));
	const [or, og, ob] = parseColor(options.color ?? '#ffffff');

	const srcW = source.width;
	const srcH = source.height;
	const pad = outlineWidth;
	const w = srcW + pad * 2;
	const h = srcH + pad * 2;

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Could not get 2d context');

	ctx.clearRect(0, 0, w, h);
	ctx.drawImage(source, pad, pad);
	const { data } = ctx.getImageData(0, 0, w, h);

	const mask = new Uint8Array(w * h);
	for (let i = 0; i < mask.length; i++) {
		mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
	}

	const dilated = dilateCircular(mask, w, h, outlineWidth);

	const out = ctx.createImageData(w, h);
	const outData = out.data;
	for (let i = 0; i < dilated.length; i++) {
		if (!dilated[i]) continue;
		const o = i * 4;
		outData[o] = or;
		outData[o + 1] = og;
		outData[o + 2] = ob;
		outData[o + 3] = 255;
	}

	ctx.putImageData(out, 0, 0);
	ctx.drawImage(source, pad, pad);

	const cropped = cropToOpaque(canvas);
	return canvasToPngBlob(cropped);
}

function dilateCircular(
	mask: Uint8Array,
	w: number,
	h: number,
	radius: number
): Uint8Array {
	const out = new Uint8Array(mask.length);
	const r2 = radius * radius;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!mask[y * w + x]) continue;
			for (let dy = -radius; dy <= radius; dy++) {
				const ny = y + dy;
				if (ny < 0 || ny >= h) continue;
				for (let dx = -radius; dx <= radius; dx++) {
					if (dx * dx + dy * dy > r2) continue;
					const nx = x + dx;
					if (nx < 0 || nx >= w) continue;
					out[ny * w + nx] = 1;
				}
			}
		}
	}

	return out;
}

function cropToOpaque(source: HTMLCanvasElement): HTMLCanvasElement {
	const ctx = source.getContext('2d', { willReadFrequently: true });
	if (!ctx) return source;
	const { width, height } = source;
	const { data } = ctx.getImageData(0, 0, width, height);

	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}

	if (maxX < 0) return source;

	const cw = maxX - minX + 1;
	const ch = maxY - minY + 1;
	const out = document.createElement('canvas');
	out.width = cw;
	out.height = ch;
	const outCtx = out.getContext('2d');
	if (!outCtx) return source;
	outCtx.drawImage(source, minX, minY, cw, ch, 0, 0, cw, ch);
	return out;
}

function parseColor(color: string): [number, number, number] {
	const hex = color.trim();
	if (hex.startsWith('#') && (hex.length === 4 || hex.length === 7)) {
		if (hex.length === 4) {
			return [
				parseInt(hex[1] + hex[1], 16),
				parseInt(hex[2] + hex[2], 16),
				parseInt(hex[3] + hex[3], 16)
			];
		}
		return [
			parseInt(hex.slice(1, 3), 16),
			parseInt(hex.slice(3, 5), 16),
			parseInt(hex.slice(5, 7), 16)
		];
	}
	return [255, 255, 255];
}
