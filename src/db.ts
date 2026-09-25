import type { ProjectInputs, ReferenceItem, StageRuntimeState, StageWiring } from "./types";

// ---------------------------------------------------------------------------
// IndexedDB persistence for full projects (inputs, wiring, and every stage's
// output — including generated images/audio/video, now plain data: URL
// strings, see blob.ts). localStorage stays for small, always-cheap state
// (API keys, credit tracking, a lightweight text/scenes-only fallback); this
// is for the parts too large or too project-specific for that.
//
// One record with id ACTIVE_PROJECT_ID autosaves continuously — the "resume
// where I left off" project. Any other record is a named snapshot the
// creator explicitly saved, browsable/loadable from the Projects panel.
// ---------------------------------------------------------------------------

export const ACTIVE_PROJECT_ID = "__active__";

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  inputs: ProjectInputs;
  wiring: Record<string, StageWiring>;
  runtime: Record<string, StageRuntimeState>;
  references: ReferenceItem[];
}

const DB_NAME = "ai-yt-studio";
const DB_VERSION = 1;
const STORE = "projects";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser has no IndexedDB support."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB."));
    });
  }
  return dbPromise;
}

function runTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
      }),
  );
}

export async function putProject(record: ProjectRecord): Promise<void> {
  await runTx("readwrite", (store) => store.put(record));
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return runTx("readonly", (store) => store.get(id));
}

/** Named snapshots only — excludes the continuously-autosaving active project. */
export async function listSavedProjects(): Promise<ProjectRecord[]> {
  const all = await runTx<ProjectRecord[]>("readonly", (store) => store.getAll());
  return all.filter((p) => p.id !== ACTIVE_PROJECT_ID).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await runTx("readwrite", (store) => store.delete(id));
}
