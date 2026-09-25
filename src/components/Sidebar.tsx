import { STAGES } from "../stages";
import { useStore, setView, isStageStale } from "../store";
import { runAll } from "../engine";
import {
  IconSearch,
  IconScript,
  IconFilm,
  IconImage,
  IconVideo,
  IconMic,
  IconLayers,
  IconSettings,
  IconBolt,
  IconStop,
  IconFolder,
  IconSend,
} from "../icons";
import type { StageStatus } from "../types";

const STAGE_ICON: Record<string, (p: any) => JSX.Element> = {
  research: IconSearch,
  script: IconScript,
  visuals: IconFilm,
  images: IconImage,
  video: IconVideo,
  voiceover: IconMic,
  assemble: IconLayers,
  publish: IconSend,
};

export function Sidebar({ running, onRunAll, onStopAll }: { running: boolean; onRunAll: () => void; onStopAll: () => void }) {
  const view = useStore((s) => s.view);
  const runtime = useStore((s) => s.runtime);
  const activeProjectName = useStore((s) => s.activeProjectName);
  // isStageStale() also reads inputs/wiring/references, which don't change the
  // "runtime" object reference above — subscribe to them too so a stale badge
  // appears the moment they do, not just when runtime itself next changes.
  useStore((s) => s.inputs);
  useStore((s) => s.wiring);
  useStore((s) => s.references);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">
          <IconBolt size={19} />
        </div>
        <div className="brand-text">
          <h1>AI YT Studio</h1>
          <div className="sub">agentic video pipeline</div>
        </div>
      </div>

      <div className="rail">
        <div className="rail-label">Pipeline</div>
        {STAGES.map((stage, i) => {
          const Icon = STAGE_ICON[stage.id];
          const status: StageStatus = runtime[stage.id]?.status ?? "idle";
          const stale = status === "done" && isStageStale(stage.id);
          return (
            <button
              key={stage.id}
              className={"stage-item" + (view === stage.id ? " active" : "")}
              onClick={() => setView(stage.id)}
              title={stage.title}
              aria-label={`Stage ${i + 1}: ${stage.title} (${stale ? "done, stale" : status})`}
            >
              <span className="stage-num">{i + 1}</span>
              <span className="stage-meta">
                <span className="stage-title">
                  <Icon size={15} />
                  <span className="stage-name">{stage.title}</span>
                </span>
                <span className="stage-sub">{stage.short}</span>
              </span>
              <span
                className={"dot " + (stale ? "stale" : status)}
                title={stale ? "Done, but out of date — something it depends on changed" : status}
              />
            </button>
          );
        })}
      </div>

      <div className="rail-foot">
        {running ? (
          <button className="btn full danger" onClick={onStopAll} title="Stop" aria-label="Stop">
            <IconStop size={15} /> <span className="btn-label">Stop</span>
          </button>
        ) : (
          <button
            className="btn primary full"
            onClick={onRunAll}
            title="Run full pipeline"
            aria-label="Run full pipeline"
          >
            <IconBolt size={15} /> <span className="btn-label">Run full pipeline</span>
          </button>
        )}
        <button
          className={"btn ghost full" + (view === "projects" ? " active" : "")}
          style={{ marginTop: 8 }}
          onClick={() => setView("projects")}
          title={activeProjectName ? `Projects (current: ${activeProjectName})` : "Projects"}
          aria-label="Projects"
        >
          <IconFolder size={15} />{" "}
          <span className="btn-label">{activeProjectName ? `Project: ${activeProjectName}` : "Projects"}</span>
        </button>
        <button
          className={"btn ghost full" + (view === "settings" ? " active" : "")}
          style={{ marginTop: 8 }}
          onClick={() => setView("settings")}
          title="Settings & API keys"
          aria-label="Settings & API keys"
        >
          <IconSettings size={15} /> <span className="btn-label">Settings &amp; API keys</span>
        </button>
      </div>
    </aside>
  );
}
