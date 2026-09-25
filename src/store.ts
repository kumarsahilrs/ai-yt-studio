import { useSyncExternalStore } from "react";
import type {
  AspectRatio,
  ProjectInputs,
  StageRuntimeState,
  StageWiring,
} from "./types";
import { STAGES } from "./stages";
import { providersFor, getProvider } from "./providers";

// ---------------------------------------------------------------------------
// Dependency-free global store with localStorage persistence. API keys are
// also saved to a file via the dev server (see keysFilePlugin in
// vite.config.ts), because browser storage can be wiped by an app restart.
// ---------------------------------------------------------------------------

const LS_KEY = "ai-yt-studio:v1";
const KEYS_ENDPOINT = "/__studio/keys";

type Secrets = Record<string, Record<string, string>>;

export interface KeysFileState {
  /** loading: asking the dev server · disk: keys file available · browser: no file store, browser storage only */
  mode: "loading" | "disk" | "browser";
  path?: string;
  /** Normalized JSON of the keys as last saved/loaded; differs from the current keys when there are unsaved edits. */
  savedSnapshot: string;
  saving?: boolean;
  savedAt?: number;
  error?: string;
}

export interface AppState {
  inputs: ProjectInputs;
  /** providerId -> { fieldKey: value } (API keys etc.) */
  secrets: Secrets;
  /** Save status of the API keys file (not persisted). */
  keys: KeysFileState;
  /** stageId -> wiring (provider + params + systemPrompt) */
  wiring: Record<string, StageWiring>;
  /** stageId -> runtime output/status */
  runtime: Record<string, StageRuntimeState>;
  /** which stage panel is open, or "settings" */
  view: string;
}

function defaultParamsFor(providerId: string): Record<string, string> {
  const p = getProvider(providerId);
  const out: Record<string, string> = {};
  p?.params.forEach((f) => {
    if (f.default !== undefined) out[f.key] = f.default;
  });
  return out;
}

function buildDefaults(): AppState {
  const wiring: Record<string, StageWiring> = {};
  const runtime: Record<string, StageRuntimeState> = {};
  for (const stage of STAGES) {
    runtime[stage.id] = { status: "idle" };
    if (stage.kind === "assemble") continue;
    const options = providersFor(stage.kind);
    const first = options[0];
    wiring[stage.id] = {
      providerId: first?.id ?? "",
      params: defaultParamsFor(first?.id ?? ""),
      systemPrompt: stage.defaultSystemPrompt,
    };
  }
  return {
    inputs: {
      topic: "",
      dimensions: "16:9" as AspectRatio,
      duration: "60s",
      audienceType: "General",
      ageGroup: "18-34",
    },
    secrets: {},
    keys: { mode: "loading", savedSnapshot: "{}" },
    wiring,
    runtime,
    view: STAGES[0].id,
  };
}

function hydrate(): AppState {
  const base = buildDefaults();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    // Merge persisted fields; do NOT restore volatile blob URLs (images/audio).
    return {
      ...base,
      inputs: { ...base.inputs, ...saved.inputs },
      secrets: { ...base.secrets, ...saved.secrets },
      wiring: mergeWiring(base.wiring, saved.wiring),
      runtime: mergeRuntime(base.runtime, saved.runtime),
      view: base.view,
    };
  } catch {
    return base;
  }
}

function mergeWiring(
  base: Record<string, StageWiring>,
  saved: Record<string, StageWiring> | undefined,
): Record<string, StageWiring> {
  if (!saved) return base;
  const out = { ...base };
  for (const id of Object.keys(base)) {
    if (saved[id]) out[id] = { ...base[id], ...saved[id], params: { ...base[id].params, ...saved[id].params } };
  }
  return out;
}

function mergeRuntime(
  base: Record<string, StageRuntimeState>,
  saved: Record<string, StageRuntimeState> | undefined,
): Record<string, StageRuntimeState> {
  if (!saved) return base;
  const out = { ...base };
  for (const id of Object.keys(base)) {
    if (saved[id]) {
      // Restore only durable text/scenes — never volatile blob/object URLs.
      out[id] = {
        status: saved[id].text || saved[id].scenes ? "done" : "idle",
        text: saved[id].text,
        scenes: saved[id].scenes,
      };
    }
  }
  return out;
}

function persist(state: AppState) {
  try {
    const runtimeToSave: Record<string, any> = {};
    for (const [id, rt] of Object.entries(state.runtime)) {
      runtimeToSave[id] = { text: rt.text, scenes: rt.scenes };
    }
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        inputs: state.inputs,
        secrets: state.secrets,
        wiring: state.wiring,
        runtime: runtimeToSave,
      }),
    );
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// --- store plumbing --------------------------------------------------------

let state: AppState = hydrate();
const listeners = new Set<() => void>();

function emit() {
  persist(state);
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const patch = typeof update === "function" ? update(state) : update;
  state = { ...state, ...patch };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

// --- typed mutators --------------------------------------------------------

export function setInputs(patch: Partial<ProjectInputs>) {
  setState((s) => ({ inputs: { ...s.inputs, ...patch } }));
}

export function setView(view: string) {
  setState({ view });
}

export function setSecret(providerId: string, key: string, value: string) {
  setState((s) => ({
    secrets: { ...s.secrets, [providerId]: { ...(s.secrets[providerId] || {}), [key]: value } },
  }));
}

export function setStageProvider(stageId: string, providerId: string) {
  setState((s) => ({
    wiring: {
      ...s.wiring,
      [stageId]: { ...s.wiring[stageId], providerId, params: defaultParamsFor(providerId) },
    },
  }));
}

export function setStageParam(stageId: string, key: string, value: string) {
  setState((s) => ({
    wiring: {
      ...s.wiring,
      [stageId]: { ...s.wiring[stageId], params: { ...s.wiring[stageId].params, [key]: value } },
    },
  }));
}

export function setStagePrompt(stageId: string, systemPrompt: string) {
  setState((s) => ({
    wiring: { ...s.wiring, [stageId]: { ...s.wiring[stageId], systemPrompt } },
  }));
}

export function setRuntime(stageId: string, patch: Partial<StageRuntimeState>) {
  setState((s) => ({
    runtime: { ...s.runtime, [stageId]: { ...s.runtime[stageId], ...patch } },
  }));
}

/** Merged config passed to a provider's run function. */
export function stageConfig(stageId: string): Record<string, string> {
  const w = state.wiring[stageId];
  if (!w) return {};
  const secrets = state.secrets[w.providerId] || {};
  return { ...secrets, ...w.params };
}

// --- API keys file ---------------------------------------------------------

/** Drops empty values, trims pasted whitespace, and sorts, so snapshots compare reliably. */
function normalizeSecrets(s: Secrets): Secrets {
  const out: Secrets = {};
  for (const provider of Object.keys(s || {}).sort()) {
    const fields: Record<string, string> = {};
    for (const key of Object.keys(s[provider] || {}).sort()) {
      const value = s[provider][key];
      if (typeof value === "string" && value.trim()) fields[key] = value.trim();
    }
    if (Object.keys(fields).length) out[provider] = fields;
  }
  return out;
}

export function hasUnsavedKeys(s: AppState = state): boolean {
  return s.keys.mode !== "loading" && JSON.stringify(normalizeSecrets(s.secrets)) !== s.keys.savedSnapshot;
}

/** Called once at startup: restores keys from the file, filling in anything browser storage lost. */
export async function loadKeysFromDisk(): Promise<void> {
  try {
    const res = await fetch(KEYS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const disk = normalizeSecrets(body.secrets || {});
    setState((s) => {
      // Values still in browser storage win — they may be edits that weren't saved yet
      // (they stay flagged as unsaved). The file fills in everything else.
      const merged: Secrets = { ...disk };
      for (const [provider, fields] of Object.entries(normalizeSecrets(s.secrets))) {
        merged[provider] = { ...(merged[provider] || {}), ...fields };
      }
      return { secrets: merged, keys: { mode: "disk", path: body.path, savedSnapshot: JSON.stringify(disk) } };
    });
  } catch {
    // No keys file store (e.g. a production build without the dev server).
    setState((s) => ({
      keys: { mode: "browser", savedSnapshot: JSON.stringify(normalizeSecrets(s.secrets)) },
    }));
  }
}

export async function saveKeys(): Promise<void> {
  const snapshot = normalizeSecrets(state.secrets);
  const snapshotJson = JSON.stringify(snapshot);
  setState((s) => ({ keys: { ...s.keys, saving: true, error: undefined } }));

  if (state.keys.mode !== "disk") {
    // Browser storage is all we have here, and persist() already wrote it.
    setState((s) => ({ keys: { ...s.keys, saving: false, savedSnapshot: snapshotJson, savedAt: Date.now() } }));
    return;
  }
  try {
    const res = await fetch(KEYS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: snapshot }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setState((s) => ({
      keys: { ...s.keys, saving: false, savedSnapshot: snapshotJson, savedAt: Date.now(), path: body.path ?? s.keys.path },
    }));
  } catch (err) {
    setState((s) => ({
      keys: { ...s.keys, saving: false, error: `Couldn't save keys: ${(err as Error).message}` },
    }));
  }
}
