const DB_NAME = 'friendship-book-page';
const STORE = 'page';
const DB_VERSION = 1;
const PAGE_KEY = 'current';

export type PersistedTextItem = {
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

export type PersistedStickerItem = {
	id: number;
	kind: 'sticker';
	x: number;
	y: number;
	src: string;
	w: number;
	h: number;
};

export type PersistedItem = PersistedTextItem | PersistedStickerItem;

export type SavedPage = {
	id: typeof PAGE_KEY;
	drawing: Blob | null;
	boardWidth: number;
	boardHeight: number;
	items: PersistedItem[];
	updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('Failed to open page database'));
	});
}

function txDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Page database transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('Page database transaction aborted'));
	});
}

export async function loadPage(): Promise<SavedPage | null> {
	if (typeof indexedDB === 'undefined') return null;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).get(PAGE_KEY);
		req.onsuccess = () => resolve((req.result as SavedPage | undefined) ?? null);
		req.onerror = () => reject(req.error ?? new Error('Failed to load page'));
	});
}

export async function savePage(input: {
	drawing: Blob | null;
	boardWidth: number;
	boardHeight: number;
	items: PersistedItem[];
}): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	const row: SavedPage = {
		id: PAGE_KEY,
		drawing: input.drawing,
		boardWidth: input.boardWidth,
		boardHeight: input.boardHeight,
		items: input.items,
		updatedAt: Date.now()
	};
	const db = await openDb();
	const tx = db.transaction(STORE, 'readwrite');
	tx.objectStore(STORE).put(row);
	await txDone(tx);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), 'image/png');
	});
}
