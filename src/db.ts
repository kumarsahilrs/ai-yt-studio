import type { Platform, ProjectInputs, ReferenceItem, StageRuntimeState, StageWiring } from "./types";

// ---------------------------------------------------------------------------
// IndexedDB persistence. Two things live here:
//
// 1. Full projects (inputs, wiring, every stage's output — including
//    generated images/audio/video, now plain data: URL strings, see
//    blob.ts). localStorage stays for small, always-cheap state (API keys,
//    credit tracking, a lightweight text/scenes-only fallback); this is for
//    the parts too large or too project-specific for that.
//
//    One record with id ACTIVE_PROJECT_ID autosaves continuously — the
//    "resume where I left off" project. Any other record is a named
//    snapshot the creator explicitly saved, browsable/loadable from the
//    Projects panel.
//
// 2. The Content Calendar: a channel brief (what the creator pasted/
//    uploaded), the topic library it (and manual additions) populate, and
//    calendar slots that schedule a library topic onto a date.
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

/** A single content idea, grouped by category — the unit the calendar schedules. */
export interface LibraryTopic {
  id: string;
  category: string;
  title: string;
  /** Why this topic / the angle to take — carried into the pipeline's Topic input as context. */
  angle?: string;
  notes?: string;
  platforms?: Platform[];
  status: "idea" | "scheduled" | "done";
  createdAt: number;
  /** Which channel brief analysis produced this (undefined = added by hand). */
  sourceBriefId?: string;
}

/** A raw channel-idea dump the creator pasted/uploaded, and what it produced. */
export interface ChannelBrief {
  id: string;
  rawText: string;
  createdAt: number;
  analyzedAt?: number;
  topicCount?: number;
}

/** A library topic scheduled onto a specific date. */
export interface CalendarSlot {
  id: string;
  date: string; // YYYY-MM-DD, local
  title: string;
  category?: string;
  platforms?: Platform[];
  topicId?: string;
  /** Why this topic on this date — from the auto-scheduler, or blank if scheduled by hand. */
  rationale?: string;
  status: "planned" | "in-progress" | "done";
  /** Set once "Start this video" links this slot to a working project. */
  linkedProjectId?: string;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "ai-yt-studio";
const DB_VERSION = 2;
const STORE_PROJECTS = "projects";
const STORE_TOPICS = "libraryTopics";
const STORE_BRIEFS = "channelBriefs";
const STORE_SLOTS = "calendarSlots";

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
        for (const name of [STORE_PROJECTS, STORE_TOPICS, STORE_BRIEFS, STORE_SLOTS]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB."));
    });
  }
  return dbPromise;
}

function runTx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
      }),
  );
}

/** Applies several writes to one store in a single transaction — for a bulk
 *  import (e.g. a channel brief analysis writing many topics/slots at once)
 *  so it can't be left half-written by a mid-batch failure. */
function runBatch<T>(store: string, items: T[], apply: (s: IDBObjectStore, item: T) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, "readwrite");
        const s = t.objectStore(store);
        for (const item of items) apply(s, item);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error("IndexedDB batch write failed."));
      }),
  );
}

// --- Projects ----------------------------------------------------------------

export async function putProject(record: ProjectRecord): Promise<void> {
  await runTx(STORE_PROJECTS, "readwrite", (s) => s.put(record));
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return runTx(STORE_PROJECTS, "readonly", (s) => s.get(id));
}

/** Named snapshots only — excludes the continuously-autosaving active project. */
export async function listSavedProjects(): Promise<ProjectRecord[]> {
  const all = await runTx<ProjectRecord[]>(STORE_PROJECTS, "readonly", (s) => s.getAll());
  return all.filter((p) => p.id !== ACTIVE_PROJECT_ID).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await runTx(STORE_PROJECTS, "readwrite", (s) => s.delete(id));
}

// --- Topic Library -------------------------------------------------------------

export async function putLibraryTopic(topic: LibraryTopic): Promise<void> {
  await runTx(STORE_TOPICS, "readwrite", (s) => s.put(topic));
}

export async function putLibraryTopics(topics: LibraryTopic[]): Promise<void> {
  await runBatch(STORE_TOPICS, topics, (s, t) => s.put(t));
}

export async function listLibraryTopics(): Promise<LibraryTopic[]> {
  const all = await runTx<LibraryTopic[]>(STORE_TOPICS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteLibraryTopic(id: string): Promise<void> {
  await runTx(STORE_TOPICS, "readwrite", (s) => s.delete(id));
}

// --- Channel Briefs --------------------------------------------------------

export async function putChannelBrief(brief: ChannelBrief): Promise<void> {
  await runTx(STORE_BRIEFS, "readwrite", (s) => s.put(brief));
}

export async function listChannelBriefs(): Promise<ChannelBrief[]> {
  const all = await runTx<ChannelBrief[]>(STORE_BRIEFS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteChannelBrief(id: string): Promise<void> {
  await runTx(STORE_BRIEFS, "readwrite", (s) => s.delete(id));
}

// --- Calendar Slots ----------------------------------------------------------

export async function putCalendarSlot(slot: CalendarSlot): Promise<void> {
  await runTx(STORE_SLOTS, "readwrite", (s) => s.put(slot));
}

export async function putCalendarSlots(slots: CalendarSlot[]): Promise<void> {
  await runBatch(STORE_SLOTS, slots, (s, slot) => s.put(slot));
}

export async function listCalendarSlots(): Promise<CalendarSlot[]> {
  const all = await runTx<CalendarSlot[]>(STORE_SLOTS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function deleteCalendarSlot(id: string): Promise<void> {
  await runTx(STORE_SLOTS, "readwrite", (s) => s.delete(id));
}
