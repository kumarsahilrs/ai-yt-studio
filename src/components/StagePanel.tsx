import { useState } from "react";
import { STAGES } from "../stages";
import { providersFor, getProvider, TIER_LABEL } from "../providers";
import {
  useStore,
  setStageProvider,
  setStageParam,
  setStagePrompt,
  remainingCredits,
} from "../store";
import { runStage, cancelStage } from "../engine";
import { FieldEditor } from "./FieldEditor";
import { AssemblePlayer } from "./AssemblePlayer";
import { RenderExport } from "./RenderExport";
import { ReferencesPanel } from "./ReferencesPanel";
import { IconPlay, IconStop, IconExternal, IconDownload } from "../icons";
import type { Scene } from "../types";

export function StagePanel({ stageId }: { stageId: string }) {
  const stage = STAGES.find((s) => s.id === stageId)!;
  const wiring = useStore((s) => s.wiring[stageId]);
  const rt = useStore((s) => s.runtime[stageId]) || { status: "idle" };
  const dimensions = useStore((s) => s.inputs.dimensions);
  // Scenes always come from the Visual Director stage; read unconditionally so
  // hook order stays stable when navigating between stages.
  const visualsScenes = useStore((s) => s.runtime["visuals"]?.scenes);
  // Re-render when credit usage changes; only relevant for the video stage.
  useStore((s) => s.credits);
  const running = rt.status === "running";

  const isAssemble = stage.kind === "assemble";
  const options = isAssemble ? [] : providersFor(stage.kind);
  const provider = wiring ? getProvider(wiring.providerId) : undefined;
  const isVideo = stage.kind === "video";
  const wiredRemaining = isVideo && wiring ? remainingCredits(wiring.providerId) : undefined;
  const wiredOutOfCredits = wiredRemaining === 0;

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

        {stage.kind === "llm" && stage.id !== "visuals" && (
          <LlmOutput text={rt.text} running={running} />
        )}

        {stage.id === "visuals" && (
          <ScenesView scenes={rt.scenes} images={undefined} dimensions={dimensions} running={running} rawText={rt.text} />
        )}

        {stage.kind === "image" && (
          <ScenesView
            scenes={visualsScenes}
            images={rt.images}
            dimensions={dimensions}
            running={running}
            rawText={undefined}
          />
        )}

        {stage.kind === "video" && (
          <ScenesView
            scenes={visualsScenes}
            videos={rt.videos || {}}
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

function ScenesView({
  scenes,
  images,
  videos,
  dimensions,
  running,
  rawText,
}: {
  scenes?: Scene[];
  images?: Record<number, string>;
  videos?: Record<number, string>;
  dimensions: string;
  running: boolean;
  rawText?: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const videoMode = !!videos;
  const mediaMode = videoMode || !!images;
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
