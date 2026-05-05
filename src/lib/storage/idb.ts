type StoreName = "kv";

const DB_NAME = "whisperbox-client";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("kv" satisfies StoreName, mode);
      const store = tx.objectStore("kv");
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const val = await withStore("readonly", (s) => s.get(key));
  return val as T | undefined;
}

export async function idbSet<T = unknown>(key: string, value: T): Promise<void> {
  await withStore("readwrite", (s) => s.put(value, key));
}

export async function idbDel(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

