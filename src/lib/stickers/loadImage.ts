/** Decode a Blob/File into an ImageBitmap, optionally downscaling so the longest edge ≤ maxEdge. */

export async function loadImage(
	input: Blob,
	maxEdge = 1280
): Promise<ImageBitmap> {
	const bitmap = await createImageBitmap(input);
	const { width, height } = bitmap;
	const longest = Math.max(width, height);

	if (longest <= maxEdge) return bitmap;

	const scale = maxEdge / longest;
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	const resized = await createImageBitmap(bitmap, {
		resizeWidth: w,
		resizeHeight: h,
		resizeQuality: 'high'
	});
	bitmap.close();
	return resized;
}

export function imageDataFromBitmap(bitmap: ImageBitmap): ImageData {
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Could not get 2d context');
	ctx.drawImage(bitmap, 0, 0);
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function bitmapToPngBlob(bitmap: ImageBitmap): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not get 2d context');
	ctx.drawImage(bitmap, 0, 0);
	return canvasToPngBlob(canvas);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('canvas.toBlob failed'));
		}, 'image/png');
	});
}
