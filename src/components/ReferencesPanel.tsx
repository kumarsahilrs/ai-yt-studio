import { useState } from "react";
import { useStore, addReference, removeReference, retryReference } from "../store";
import { IconClose, IconRefresh, IconLink, IconExternal } from "../icons";
import type { ReferenceItem } from "../types";

const KIND_LABEL: Record<string, string> = {
  "youtube-video": "YouTube video",
  "youtube-channel": "YouTube channel",
  web: "Web page",
};

/** Lets the creator paste competitor links (YouTube videos/channels, web pages).
 *  Each is read into text by the Phase-2 backend and handed to the Research &
 *  Hook agent as grounding context. Backend-only — degrades to a clear notice
 *  when it isn't running. */
export function ReferencesPanel() {
  const references = useStore((s) => s.references);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    addReference(draft);
    setDraft("");
  };

  return (
    <div className="card">
      <h3>Creative Brief — reference links</h3>
      <div className="hint" style={{ marginBottom: 10, display: "block" }}>
        Paste a competitor's YouTube video, channel, or article. The Phase-2 backend reads it into text (transcript,
        views, recent uploads, or page content) and the Research & Hook agent uses it to ground its hooks — not just
        summarize it. Needs the render backend running (<code>cd backend && uvicorn main:app --port 8000</code>).
      </div>
      <div className="wire-row">
        <div className="field grow">
          <input
            className="input"
            placeholder="https://youtube.com/watch?v=… or @channel or any article URL"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <button className="btn sm" onClick={submit} disabled={!draft.trim()}>
          <IconLink size={14} /> Add
        </button>
      </div>

      {references.length > 0 && (
        <div className="ref-list" style={{ marginTop: 12 }}>
          {references.map((r) => (
            <ReferenceRow key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceRow({ r }: { r: ReferenceItem }) {
  return (
    <div className="ref-item">
      <div className="ref-main">
        <div className="row" style={{ gap: 8 }}>
          {r.status === "loading" && <span className="spinner sm" />}
          <span className="t">{r.title || r.url}</span>
          {r.kind && <span className="pill">{KIND_LABEL[r.kind] ?? r.kind}</span>}
        </div>
        {r.status === "error" && <div className="error-box" style={{ marginTop: 6 }}>{r.error}</div>}
        {r.status === "done" && r.author && <div className="hint">{r.author}</div>}
        <a className="link-ext" href={r.url} target="_blank" rel="noreferrer" style={{ marginTop: 4 }}>
          {r.url} <IconExternal size={11} />
        </a>
      </div>
      <div className="ref-actions">
        {r.status === "error" && (
          <button className="btn sm ghost" onClick={() => retryReference(r.id)} title="Retry">
            <IconRefresh size={13} />
          </button>
        )}
        <button className="btn sm ghost" onClick={() => removeReference(r.id)} title="Remove">
          <IconClose size={13} />
        </button>
      </div>
    </div>
  );
}
