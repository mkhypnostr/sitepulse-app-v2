// Cihazda kalıcı saklama (IndexedDB). İnternet yokken keşif kayıtları ve
// fotoğrafları burada tutulur; bağlantı gelince sunucuya gönderilir.
// Tarayıcı verisi temizlenmedikçe kalıcıdır; sayfa kapanınca silinmez.

const DB_NAME = "nes-offline";
const DB_VERSION = 1;
export const STORES = ["surveys", "photos", "cache"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("Bu tarayıcı çevrimdışı saklamayı desteklemiyor."),
    );
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) =>
  run<T | undefined>(store, "readonly", (s) => s.get(key));
export const idbSet = (store: StoreName, key: string, value: unknown) =>
  run<IDBValidKey>(store, "readwrite", (s) => s.put(value, key));
export const idbDelete = (store: StoreName, key: string) =>
  run<undefined>(store, "readwrite", (s) => s.delete(key));
export const idbAll = <T>(store: StoreName) =>
  run<T[]>(store, "readonly", (s) => s.getAll());

/** Tarayıcıdan, depolama dolsa bile silinmemesini iste (destekleyenlerde). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Desteklenmiyorsa normal saklama sürer.
  }
}
