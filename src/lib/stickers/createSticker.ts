import { addOutline } from './addOutline';
import { hasTransparency } from './hasTransparency';
import {
	bitmapToPngBlob,
	imageDataFromBitmap,
	loadImage
} from './loadImage';
import { removeBackground } from './removeBackground';

export type CreateStickerOptions = {
	outlineWidth?: number;
	outlineColor?: string;
	/** Longest edge after decode; default 1280. */
	maxEdge?: number;
	/** Always run background removal, even if the image already has alpha. */
	forceRemoveBackground?: boolean;
};

/**
 * Turn a photo (or cutout) into an Instagram-style sticker PNG:
 * remove background when needed, then add a white outline.
 */
export async function createSticker(
	input: Blob | File,
	options: CreateStickerOptions = {}
): Promise<Blob> {
	const maxEdge = options.maxEdge ?? 1280;
	let bitmap = await loadImage(input, maxEdge);

	const skipRemoval =
		!options.forceRemoveBackground && hasTransparency(imageDataFromBitmap(bitmap));

	if (!skipRemoval) {
		const resized = await bitmapToPngBlob(bitmap);
		bitmap.close();
		const cutout = await removeBackground(resized);
		bitmap = await createImageBitmap(cutout);
	}

	try {
		return await addOutline(bitmap, {
			width: options.outlineWidth,
			color: options.outlineColor
		});
	} finally {
		bitmap.close();
	}
}
