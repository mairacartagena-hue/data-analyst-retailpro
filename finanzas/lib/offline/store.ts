"use client";

// Copia local (IndexedDB) para usar la app sin conexión: los últimos datos cargados y la cola de
// movimientos por enviar. Vive solo en este celular y se borra al cerrar sesión.

const DB = "finanzas-offline";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Sin IndexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    return ((await run<T | undefined>("readonly", (s) => s.get(key))) ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: unknown): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(value, key));
  } catch {
    // Sin espacio o en una ventana privada: la app sigue funcionando con conexión
  }
}

/** Al cerrar sesión: borra la copia local, la cola y las pantallas guardadas por el service worker. */
export async function clearOffline(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {}
  try {
    sessionStorage.removeItem("sw-warm");
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {}
}

export const snapshotKey = (userId: string) => `snapshot:${userId}`;
export const queueKey = (userId: string) => `queue:${userId}`;

/** ¿El error es por falta de conexión (y no porque la base de datos rechazó el movimiento)? */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|timed? ?out/i.test(msg);
}
