/** Browser-only background removal via @imgly/background-removal (dynamic import). */

export async function removeBackground(input: Blob): Promise<Blob> {
	const { removeBackground: imglyRemove } = await import('@imgly/background-removal');
	return imglyRemove(input);
}
