/** True when a meaningful share of pixels are not fully opaque (already a cutout). */

const ALPHA_OPAQUE = 250;
/** At least 1% of pixels, or this many — whichever is larger. */
const MIN_RATIO = 0.01;
const MIN_COUNT = 64;

export function hasTransparency(imageData: ImageData): boolean {
	const { data } = imageData;
	const pixelCount = data.length / 4;
	const threshold = Math.max(MIN_COUNT, Math.floor(pixelCount * MIN_RATIO));

	let transparent = 0;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < ALPHA_OPAQUE) {
			transparent++;
			if (transparent >= threshold) return true;
		}
	}
	return false;
}
