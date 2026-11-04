const DB_NAME = 'friendship-book';
const STORE = 'stickers';
const DB_VERSION = 1;
const LEGACY_KEY = 'friendship-book:stickers';

export type SavedSticker = {
	id: string;
	blob: Blob;
	createdAt: number;
};

type LegacySticker = {
	id: string;
	dataUrl: string;
	createdAt: number;
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
		req.onerror = () => reject(req.error ?? new Error('Failed to open sticker database'));
	});
}

function txDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Sticker database transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('Sticker database transaction aborted'));
	});
}

async function migrateLegacyLocalStorage(db: IDBDatabase) {
	if (typeof localStorage === 'undefined') return;
	const raw = localStorage.getItem(LEGACY_KEY);
	if (!raw) return;

	let legacy: LegacySticker[] = [];
	try {
		const parsed = JSON.parse(raw) as LegacySticker[];
		if (Array.isArray(parsed)) legacy = parsed;
	} catch {
		localStorage.removeItem(LEGACY_KEY);
		return;
	}

	const stickers: SavedSticker[] = [];
	for (const item of legacy) {
		if (!item?.id || !item?.dataUrl) continue;
		try {
			const res = await fetch(item.dataUrl);
			const blob = await res.blob();
			stickers.push({
				id: item.id,
				blob,
				createdAt: item.createdAt ?? Date.now()
			});
		} catch {
			/* skip bad entries */
		}
	}

	if (stickers.length) {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		for (const sticker of stickers) store.put(sticker);
		await txDone(tx);
	}

	localStorage.removeItem(LEGACY_KEY);
}

let migratePromise: Promise<void> | null = null;

async function readyDb(): Promise<IDBDatabase> {
	const db = await openDb();
	migratePromise ??= migrateLegacyLocalStorage(db).catch(() => {
		/* migration best-effort */
	});
	await migratePromise;
	return db;
}

export async function loadStickers(): Promise<SavedSticker[]> {
	if (typeof indexedDB === 'undefined') return [];
	const db = await readyDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => {
			const rows = (req.result as SavedSticker[]) ?? [];
			rows.sort((a, b) => b.createdAt - a.createdAt);
			resolve(rows);
		};
		req.onerror = () => reject(req.error ?? new Error('Failed to load stickers'));
	});
}

export async function addSticker(blob: Blob): Promise<SavedSticker> {
	const sticker: SavedSticker = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		blob,
		createdAt: Date.now()
	};
	const db = await readyDb();
	const tx = db.transaction(STORE, 'readwrite');
	tx.objectStore(STORE).put(sticker);
	await txDone(tx);
	return sticker;
}

export async function removeSticker(id: string): Promise<void> {
	const db = await readyDb();
	const tx = db.transaction(STORE, 'readwrite');
	tx.objectStore(STORE).delete(id);
	await txDone(tx);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read sticker'));
		reader.readAsDataURL(blob);
	});
}
