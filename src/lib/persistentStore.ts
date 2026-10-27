/**
 * Small string key/value store. Uses IndexedDB, which can hold far more than
 * localStorage's ~5 MB (large multi-year statements exceed that), and falls back
 * to localStorage when IndexedDB is unavailable (private windows, old browsers).
 */
const DB_NAME = "spendwise";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let persistenceRequested = false;

/**
 * Asks the browser not to evict saved data when the device runs low on space.
 * Browsers may grant this silently or ignore it; a failed request is harmless.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistenceRequested) return false;
  persistenceRequested = true;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Reads a value. A value still in localStorage from an older version is moved into IndexedDB. */
export async function readValue(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return readLocal(key);
  const stored = await new Promise<string | null>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (stored !== null) return stored;
  const legacy = readLocal(key);
  if (legacy !== null && (await writeValue(key, legacy))) {
    try {
      localStorage.removeItem(key);
    } catch {
      // The copy in IndexedDB is authoritative either way.
    }
  }
  return legacy;
}

/** Writes a value; resolves false when nothing could store it. */
export async function writeValue(key: string, value: string): Promise<boolean> {
  const db = await openDb();
  if (db) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(value, key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    if (ok) return true;
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
