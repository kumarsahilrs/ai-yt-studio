import { getProvider, providersFor } from "./providers";
import { STAGES, fillTemplate, parseScenes, dimsToPixels } from "./stages";
import { getState, setRuntime, stageConfig, configForProvider, isProviderConfigured } from "./store";
import type { Provider, ProjectInputs, RunContext, StageKind } from "./types";

// ---------------------------------------------------------------------------
// Runs individual stages and chains the whole pipeline.
// ---------------------------------------------------------------------------

const controllers: Record<string, AbortController> = {};

function inputsSummary(inputs: ProjectInputs): string {
  return (
    `Topic: ${inputs.topic}\n` +
    `Audience type: ${inputs.audienceType}\n` +
    `Age group: ${inputs.ageGroup}\n` +
    `Duration: ${inputs.duration}\n` +
    `Aspect ratio: ${inputs.dimensions}`
  );
}

/** Successfully-read Creative Brief links, formatted as competitor context for Research & Hook. */
function referencesBlock(): string {
  const done = getState().references.filter((r) => r.status === "done" && r.content);
  if (done.length === 0) return "";
  const blocks = done.map((r, i) => `[Reference ${i + 1} — ${r.url}]\n${r.content}`);
  return (
    `\n\nCreative Brief — reference material pasted by the creator (competitor videos/channels/pages).\n` +
    `Use this to ground the hooks and outline in what's actually working, don't just summarize it:\n\n` +
    blocks.join("\n\n---\n\n")
  );
}

export function cancelStage(stageId: string) {
  controllers[stageId]?.abort();
}

// ---------------------------------------------------------------------------
// Automatic per-stage provider fallback. When the stage's wired provider fails
// (quota, rate limit, missing key, backend not running, ...), retry with the
// next configured provider for that stage kind in free -> paid order, so a run
// only stops when every reachable option has actually been tried.
// ---------------------------------------------------------------------------

interface FallbackAttempt {
  providerId: string;
  error: string;
}

/** [the stage's wired provider first, then every other CONFIGURED provider of
 *  that kind in free -> paid order]. Unconfigured providers (missing key) are
 *  only ever attempted as the explicit first choice — not wasted as fallbacks. */
function fallbackCandidates(kind: StageKind, preferredId: string): Provider[] {
  const all = providersFor(kind);
  const preferred = all.find((p) => p.id === preferredId);
  const rest = all.filter((p) => p.id !== preferredId && isProviderConfigured(p.id));
  return preferred ? [preferred, ...rest] : rest;
}

async function withFallback<T>(
  stageId: string,
  kind: StageKind,
  run: (provider: Provider, ctx: RunContext) => Promise<T>,
  baseCtx: RunContext,
): Promise<{ result: T; providerId: string; note?: string }> {
  const wiring = getState().wiring[stageId];
  const candidates = fallbackCandidates(kind, wiring?.providerId ?? "");
  const attempts: FallbackAttempt[] = [];

  for (const provider of candidates) {
    if (baseCtx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const ctx: RunContext = { ...baseCtx, config: configForProvider(provider.id, stageId) };
      const result = await run(provider, ctx);
      const note =
        attempts.length > 0
          ? `Switched to ${provider.name} after ${attempts.length} other provider${attempts.length > 1 ? "s" : ""} failed.`
          : undefined;
      return { result, providerId: provider.id, note };
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      attempts.push({ providerId: provider.id, error: err?.message || String(err) });
    }
  }

  if (attempts.length <= 1) throw new Error(attempts[0]?.error || "No provider is configured for this stage.");
  const summary = attempts
    .map((a, i) => `${i + 1}. ${getProvider(a.providerId)?.name ?? a.providerId} — ${a.error}`)
    .join("\n");
  throw new Error(`All ${attempts.length} free → paid providers failed:\n${summary}`);
}

function makeCtx(stageId: string, signal: AbortSignal): RunContext {
  const { inputs } = getState();
  const { width, height } = dimsToPixels(inputs.dimensions);
  return { config: stageConfig(stageId), inputs, width, height, signal };
}

export async function runStage(stageId: string): Promise<void> {
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) return;
  const state = getState();
  const wiring = state.wiring[stageId];

  const controller = new AbortController();
  controllers[stageId] = controller;
  setRuntime(stageId, {
    status: "running",
    error: undefined,
    startedAt: Date.now(),
    finishedAt: undefined,
    usedProviderId: undefined,
    fallbackLog: undefined,
  });
  const fallbackLog: string[] = [];
  const logFallback = (prefix: string, note?: string) => {
    if (note) {
      fallbackLog.push(`${prefix}${note}`);
      setRuntime(stageId, { fallbackLog: [...fallbackLog] });
    }
  };

  try {
    const ctx = makeCtx(stageId, controller.signal);

    if (stage.kind === "llm") {
      const system = fillTemplate(wiring.systemPrompt || stage.defaultSystemPrompt || "", state.inputs);
      let user: string;
      if (stageId === "research") {
        user = inputsSummary(state.inputs) + referencesBlock();
      } else if (stageId === "script") {
        user = state.runtime["research"]?.text || inputsSummary(state.inputs);
      } else if (stageId === "visuals") {
        const script = state.runtime["script"]?.text;
        if (!script) throw new Error("Run the Scriptwriter stage first — the Visual Director needs a script.");
        user = script;
      } else {
        user = inputsSummary(state.inputs);
      }
      const { result, providerId, note } = await withFallback(stageId, "llm", (p, c) => p.runLlm!(system, user, c), ctx);
      logFallback("", note);
      if (stageId === "visuals") {
        const scenes = parseScenes(result.text);
        setRuntime(stageId, { text: result.text, scenes, usedProviderId: providerId });
      } else {
        setRuntime(stageId, { text: result.text, usedProviderId: providerId });
      }
    } else if (stage.kind === "image") {
      const scenes = getState().runtime["visuals"]?.scenes;
      if (!scenes || scenes.length === 0) {
        throw new Error("Run the Visual Director first — image generation needs scene prompts.");
      }
      const images: Record<number, string> = { ...(getState().runtime[stageId]?.images || {}) };
      for (const scene of scenes) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const { result, providerId, note } = await withFallback(
          stageId,
          "image",
          (p, c) => p.runImage!(scene.imagePrompt, c),
          ctx,
        );
        images[scene.scene] = result.url;
        logFallback(`Scene ${scene.scene}: `, note);
        setRuntime(stageId, { images: { ...images }, usedProviderId: providerId });
      }
    } else if (stage.kind === "video") {
      // Deliberately no auto-fallback: video providers run on limited trial
      // credits, so silently burning a second provider's credit on failure
      // isn't the right default — the creator picks explicitly per scene.
      const provider = getProvider(wiring?.providerId);
      if (!provider) throw new Error("No provider selected. Pick one in this stage's settings.");
      const scenes = getState().runtime["visuals"]?.scenes;
      if (!scenes || scenes.length === 0) {
        throw new Error("Run the Visual Director first — video generation needs scene prompts.");
      }
      const stills = getState().runtime["images"]?.images || {};
      const videos: Record<number, string> = { ...(getState().runtime[stageId]?.videos || {}) };
      for (const scene of scenes) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const res = await provider.runVideo!(scene.imagePrompt, stills[scene.scene], ctx);
        videos[scene.scene] = res.url;
        setRuntime(stageId, { videos: { ...videos } });
      }
    } else if (stage.kind === "tts") {
      const script = getState().runtime["script"]?.text;
      if (!script) throw new Error("Run the Scriptwriter first — the voiceover needs a script.");
      const { result, providerId, note } = await withFallback(stageId, "tts", (p, c) => p.runTts!(script, c), ctx);
      logFallback("", note);
      setRuntime(stageId, {
        audioUrl: result.url || undefined,
        audioPlaybackOnly: !!result.playbackOnly,
        usedProviderId: providerId,
      });
    }

    setRuntime(stageId, { status: "done", finishedAt: Date.now() });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      setRuntime(stageId, { status: "idle", error: undefined });
    } else {
      setRuntime(stageId, { status: "error", error: err?.message || String(err) });
    }
    throw err;
  } finally {
    delete controllers[stageId];
  }
}

/** Runs the creative pipeline end-to-end, stopping at the first failure. */
export async function runAll(): Promise<void> {
  const order = ["research", "script", "visuals", "images", "voiceover"];
  for (const id of order) {
    try {
      await runStage(id);
    } catch {
      return; // stop the chain; the failing stage already shows its error
    }
  }
}
