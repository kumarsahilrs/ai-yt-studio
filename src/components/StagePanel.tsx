import { useState } from "react";
import { STAGES, isRemoteImageUrl, PLATFORMS } from "../stages";
import { providersFor, getProvider, TIER_LABEL } from "../providers";
import {
  useStore,
  setStageProvider,
  setStageParam,
  setStagePrompt,
  remainingCredits,
  isStageStale,
  setView,
} from "../store";
import { runStage, cancelStage, regenerateSceneImage } from "../engine";
import { FieldEditor } from "./FieldEditor";
import { AssemblePlayer } from "./AssemblePlayer";
import { RenderExport } from "./RenderExport";
import { ReferencesPanel } from "./ReferencesPanel";
import { IconPlay, IconStop, IconExternal, IconDownload, IconRefresh, IconCopy, IconCheck } from "../icons";
import type { Scene, Platform, PublishPlan, PublishBlock } from "../types";

/** Generative stages, in pipeline order — used for the Storyboard/Assemble
 *  stage's "what's out of date" summary. */
const GENERATIVE_STAGE_IDS = ["research", "script", "visuals", "images", "video", "voiceover"];

export function StagePanel({ stageId }: { stageId: string }) {
  const stage = STAGES.find((s) => s.id === stageId)!;
  const wiring = useStore((s) => s.wiring[stageId]);
  const rt = useStore((s) => s.runtime[stageId]) || { status: "idle" };
  const inputs = useStore((s) => s.inputs);
  const dimensions = inputs.dimensions;
  // Scenes always come from the Visual Director stage; read unconditionally so
  // hook order stays stable when navigating between stages.
  const visualsScenes = useStore((s) => s.runtime["visuals"]?.scenes);
  const stills = useStore((s) => s.runtime["images"]?.images);
  const runtime = useStore((s) => s.runtime);
  // Re-render when credit usage changes; only relevant for the video stage.
  useStore((s) => s.credits);
  // isStageStale() also reads references (for the Research stage); subscribe
  // so a change there is reflected without needing an unrelated re-render.
  useStore((s) => s.references);
  const running = rt.status === "running";

  const isAssemble = stage.kind === "assemble";
  const options = isAssemble ? [] : providersFor(stage.kind);
  const provider = wiring ? getProvider(wiring.providerId) : undefined;
  const isVideo = stage.kind === "video";
  const wiredRemaining = isVideo && wiring ? remainingCredits(wiring.providerId) : undefined;
  const wiredOutOfCredits = wiredRemaining === 0;
  const stale = !isAssemble && rt.status === "done" && isStageStale(stageId);
  const staleUpstream = isAssemble
    ? GENERATIVE_STAGE_IDS.filter((id) => runtime[id]?.status === "done" && isStageStale(id))
    : [];

  return (
    <div className="panel-wrap">
      <div className="panel-head">
        <div>
          <h2>{stage.title}</h2>
          <div className="desc">{stage.description}</div>
        </div>
        {!isAssemble && (
          <div className="panel-actions">
            {running ? (
              <button className="btn danger" onClick={() => cancelStage(stageId)}>
                <IconStop size={15} /> Stop
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => runStage(stageId)}
                disabled={wiredOutOfCredits}
                title={wiredOutOfCredits ? "No credits left for this provider — see Settings or pick another." : undefined}
              >
                <IconPlay size={15} /> Run this stage
              </button>
            )}
          </div>
        )}
      </div>

      {stageId === "research" && <ReferencesPanel />}

      {/* --- wiring card --- */}
      {!isAssemble && wiring && (
        <div className="card">
          <h3>Provider wiring</h3>
          <div className="wire-row">
            <div className="field" style={{ minWidth: 260 }}>
              <label>Provider (free → paid)</label>
              <select
                className="select"
                value={wiring.providerId}
                onChange={(e) => setStageProvider(stageId, e.target.value)}
              >
                {options.map((p) => {
                  const remaining = isVideo ? remainingCredits(p.id) : undefined;
                  const outOfCredits = remaining === 0;
                  return (
                    <option key={p.id} value={p.id} disabled={outOfCredits}>
                      [{TIER_LABEL[p.tier]}] {p.name}
                      {p.note ? ` — ${p.note}` : ""}
                      {remaining !== undefined ? (outOfCredits ? " — no credits left" : ` — ${remaining} credit${remaining === 1 ? "" : "s"} left`) : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            {provider?.params.map((f) => (
              <FieldEditor
                key={f.key}
                field={f}
                value={wiring.params[f.key] ?? ""}
                onChange={(v) => setStageParam(stageId, f.key, v)}
              />
            ))}
          </div>

          {provider && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className={"badge " + provider.tier}>{TIER_LABEL[provider.tier]}</span>
              {provider.secrets.length === 0 ? (
                <span className="pill">No API key needed</span>
              ) : (
                <span className="pill">Key set in Settings › API Keys</span>
              )}
              {provider.needsBackend && <span className="pill">⚠ Needs Phase-2 backend</span>}
              {isVideo && wiredRemaining !== undefined && (
                <span className={"pill" + (wiredOutOfCredits ? " danger" : "")}>
                  {wiredOutOfCredits ? "No credits left" : `${wiredRemaining} credit${wiredRemaining === 1 ? "" : "s"} left`}
                </span>
              )}
              {provider.signupUrl && (
                <a className="link-ext" href={provider.signupUrl} target="_blank" rel="noreferrer">
                  Get API key <IconExternal size={12} />
                </a>
              )}
            </div>
          )}
          {stage.kind !== "video" && (
            <div className="hint" style={{ display: "block", marginTop: 8 }}>
              If this fails, the next configured free → paid provider for this stage is tried automatically.
            </div>
          )}
          {isVideo && (
            <div className="hint" style={{ display: "block", marginTop: 8 }}>
              Track each provider's trial credits in <b>Settings &amp; API keys</b> to get a warning here before you
              run out.
            </div>
          )}

          {stage.kind === "llm" && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>System prompt (editable — supports {"{{topic}}"}, {"{{duration}}"}, {"{{audienceType}}"}, {"{{ageGroup}}"}, {"{{dimensions}}"})</label>
              <textarea
                className="textarea"
                rows={9}
                value={wiring.systemPrompt ?? ""}
                onChange={(e) => setStagePrompt(stageId, e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {/* --- output card --- */}
      <div className="card">
        <h3>Output</h3>
        {stale && (
          <div className="notice sm" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>
              ⟳ Out of date — the wiring or an earlier stage changed since this was generated. Rerun to refresh it.
            </span>
            <button className="btn sm ghost" onClick={() => runStage(stageId)} disabled={running}>
              <IconRefresh size={12} /> Rerun
            </button>
          </div>
        )}
        {isAssemble && staleUpstream.length > 0 && (
          <div className="notice sm" style={{ marginBottom: 12 }}>
            ⟳ Out of date: {staleUpstream.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <button className="link-ext link-btn" style={{ display: "inline" }} onClick={() => setView(id)}>
                  {STAGES.find((s) => s.id === id)?.title}
                </button>
              </span>
            ))}{" "}
            changed since a later stage was generated from it — the preview below may not reflect them.
          </div>
        )}
        {rt.usedProviderId && wiring && rt.usedProviderId !== wiring.providerId && (
          <div className="notice" style={{ marginBottom: 12 }}>
            ⚡ Auto-switched to <b>{getProvider(rt.usedProviderId)?.name ?? rt.usedProviderId}</b> — the selected
            provider failed. See details below.
          </div>
        )}
        {rt.fallbackLog && rt.fallbackLog.length > 0 && (
          <details style={{ marginBottom: 12 }}>
            <summary className="hint" style={{ cursor: "pointer" }}>
              Fallback details ({rt.fallbackLog.length})
            </summary>
            <div className="output mono" style={{ marginTop: 8 }}>
              {rt.fallbackLog.join("\n")}
            </div>
          </details>
        )}
        {rt.error && <div className="error-box">{rt.error}</div>}

        {stage.kind === "llm" && stage.id !== "visuals" && stage.id !== "publish" && (
          <LlmOutput text={rt.text} running={running} />
        )}

        {stage.id === "visuals" && (
          <ScenesView scenes={rt.scenes} images={undefined} dimensions={dimensions} running={running} rawText={rt.text} />
        )}

        {stage.id === "publish" && (
          <PublishOutput plan={rt.publishPlan} platforms={inputs.platforms || []} running={running} rawText={rt.text} />
        )}

        {stage.kind === "image" && (
          <ScenesView
            scenes={visualsScenes}
            images={rt.images}
            dimensions={dimensions}
            running={running}
            rawText={undefined}
            onFixScene={(n) => regenerateSceneImage(n, "pollinations")}
          />
        )}

        {stage.kind === "video" && (
          <ScenesView
            scenes={visualsScenes}
            videos={rt.videos || {}}
            stills={stills}
            dimensions={dimensions}
            running={running}
            rawText={undefined}
          />
        )}

        {stage.kind === "tts" && <VoiceoverOutput audioUrl={rt.audioUrl} playbackOnly={rt.audioPlaybackOnly} running={running} status={rt.status} onReplay={() => runStage(stageId)} />}

        {isAssemble && <AssemblePlayer />}
      </div>

      {isAssemble && <RenderExport />}
    </div>
  );
}

function LlmOutput({ text, running }: { text?: string; running: boolean }) {
  if (!text && running) return <Loading label="Generating…" />;
  if (!text) return <div className="empty">No output yet. Click “Run this stage”.</div>;
  return <div className="output">{text}</div>;
}

function PublishOutput({
  plan,
  platforms,
  running,
  rawText,
}: {
  plan?: PublishPlan;
  platforms: Platform[];
  running: boolean;
  rawText?: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  if (!plan && running) return <Loading label="Writing upload metadata…" />;
  if (!plan) return <div className="empty">No output yet. Click “Run this stage”.</div>;
  if (platforms.length === 0)
    return <div className="empty">No publish targets selected — pick at least one up top, then rerun.</div>;

  return (
    <div>
      {rawText && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn sm ghost" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
        </div>
      )}
      {showRaw && rawText && <div className="output mono" style={{ marginBottom: 14 }}>{rawText}</div>}
      <div className="publish-grid">
        {platforms.map((id) => {
          const label = PLATFORMS.find((p) => p.id === id)?.label ?? id;
          const block = plan[id];
          return (
            <div className="card publish-card" key={id}>
              <h3>{label}</h3>
              {block ? <PublishBlockView block={block} /> : <div className="empty">Not generated — rerun this stage.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PublishBlockView({ block }: { block: PublishBlock }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, which: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(which);
        setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
      })
      .catch(() => {
        /* clipboard permission denied — the text is still selectable/visible */
      });
  }
  const CopyBtn = ({ text, id }: { text: string; id: string }) => (
    <button className="btn sm ghost" onClick={() => copy(text, id)} title="Copy">
      {copied === id ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );

  return (
    <div>
      {block.titles.length > 0 && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Title options</label>
          {block.titles.map((t, i) => (
            <div className="row" key={i} style={{ marginTop: 4, alignItems: "flex-start" }}>
              <span className="output" style={{ flex: 1 }}>
                {t}
              </span>
              <CopyBtn text={t} id={`title-${i}`} />
            </div>
          ))}
        </div>
      )}
      {block.description && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Description</label>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="output" style={{ flex: 1 }}>
              {block.description}
            </div>
            <CopyBtn text={block.description} id="desc" />
          </div>
        </div>
      )}
      {block.tags.length > 0 && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Tags</label>
          <div className="row">
            {block.tags.map((t) => (
              <span className="pill" key={t}>
                #{t}
              </span>
            ))}
            <CopyBtn text={block.tags.map((t) => `#${t}`).join(" ")} id="tags" />
          </div>
        </div>
      )}
      {block.notes && <div className="notice sm">{block.notes}</div>}
    </div>
  );
}

function ScenesView({
  scenes,
  images,
  videos,
  stills,
  dimensions,
  running,
  rawText,
  onFixScene,
}: {
  scenes?: Scene[];
  images?: Record<number, string>;
  videos?: Record<number, string>;
  /** Only passed for the video stage: the stills from Image Generation, so a
   *  scene backed by a non-animatable local image can be flagged here too. */
  stills?: Record<number, string>;
  dimensions: string;
  running: boolean;
  rawText?: string;
  /** Only passed for the image stage: regenerates one scene's image with a
   *  specific (always-public) provider, e.g. to fix a non-animatable blob URL. */
  onFixScene?: (sceneNumber: number) => Promise<void>;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [fixing, setFixing] = useState<number | null>(null);
  const videoMode = !!videos;
  const mediaMode = videoMode || !!images;
  const stillsForCheck = images ?? stills;
  if ((!scenes || scenes.length === 0) && running) return <Loading label="Working…" />;
  if (!scenes || scenes.length === 0)
    return <div className="empty">No scenes yet. Run the Visual Director to break the script into scenes.</div>;

  const ratioClass = dimensions === "9:16" ? "r916" : dimensions === "1:1" ? "r11" : "";
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="pill">{scenes.length} scenes</span>
        {images && <span className="pill">{Object.keys(images).length} images rendered</span>}
        {videos && <span className="pill">{Object.keys(videos).length} clips rendered</span>}
        {rawText && (
          <button className="btn sm ghost" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
        )}
      </div>
      {showRaw && rawText && <div className="output mono" style={{ marginBottom: 14 }}>{rawText}</div>}
      <div className="scene-grid">
        {scenes.map((sc) => {
          const img = images?.[sc.scene];
          const vid = videos?.[sc.scene];
          const media = videoMode ? vid : img;
          const still = stillsForCheck?.[sc.scene];
          const notAnimatable = !!still && !isRemoteImageUrl(still);
          const isFixing = fixing === sc.scene;
          return (
            <div className="scene-card" key={sc.scene}>
              {mediaMode && (
                <div className={"scene-thumb " + ratioClass}>
                  {media ? (
                    videoMode ? (
                      <video src={vid} controls loop muted playsInline />
                    ) : (
                      <img src={img} alt={`Scene ${sc.scene}`} />
                    )
                  ) : running ? (
                    <div className="spinner" />
                  ) : (
                    <span>queued…</span>
                  )}
                </div>
              )}
              <div className="scene-body">
                <div className="t">
                  #{sc.scene} · {sc.time}
                </div>
                {sc.narration && <div className="n">{sc.narration}</div>}
                <div className="p">🎨 {sc.imagePrompt}</div>
                {sc.onScreenText && <div className="p" style={{ marginTop: 4 }}>📝 {sc.onScreenText}</div>}
                {media && (
                  <a className="link-ext" href={media} target="_blank" rel="noreferrer" style={{ marginTop: 6 }}>
                    Open {videoMode ? "clip" : "image"} <IconExternal size={12} />
                  </a>
                )}
                {notAnimatable && (
                  <div className="notice sm" style={{ marginTop: 8 }}>
                    ⚠ Local image — most video providers (Runway, MiniMax I2V, fal/Luma image mode) can't animate it.
                    {onFixScene ? (
                      <>
                        {" "}
                        <button
                          className="btn sm ghost"
                          disabled={isFixing}
                          onClick={async () => {
                            setFixing(sc.scene);
                            try {
                              await onFixScene(sc.scene);
                            } catch {
                              /* the scene keeps its old image; nothing else to do here */
                            } finally {
                              setFixing(null);
                            }
                          }}
                        >
                          {isFixing ? "Fixing…" : "Fix: regenerate via Pollinations"}
                        </button>
                      </>
                    ) : (
                      " Fix it from Image Generation."
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoiceoverOutput({
  audioUrl,
  playbackOnly,
  running,
  status,
  onReplay,
}: {
  audioUrl?: string;
  playbackOnly?: boolean;
  running: boolean;
  status: string;
  onReplay: () => void;
}) {
  if (running) return <Loading label="Synthesizing voice…" />;
  if (playbackOnly && status === "done") {
    return (
      <div>
        <div className="notice">
          The browser <b>Web Speech</b> voice plays live and can’t be saved to a file. Click below to hear it again, or
          switch to <b>ElevenLabs</b>/<b>OpenAI TTS</b> (or the Phase-2 <b>Edge-TTS</b> backend) to get a downloadable
          audio file.
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={onReplay}>
            <IconPlay size={15} /> Play again
          </button>
        </div>
      </div>
    );
  }
  if (!audioUrl) return <div className="empty">No audio yet. Run the Voiceover stage.</div>;
  return (
    <div>
      <audio controls src={audioUrl} style={{ width: "100%" }} />
      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn sm" href={audioUrl} download="voiceover.mp3">
          <IconDownload size={14} /> Download audio
        </a>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="row" style={{ padding: "18px 0" }}>
      <div className="spinner" />
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
    </div>
  );
}
