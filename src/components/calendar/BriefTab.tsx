import { useRef, useState } from "react";
import { analyzeChannelBrief } from "../../planner";
import { deleteChannelBrief } from "../../db";
import type { ChannelBrief } from "../../db";
import { IconTrash } from "../../icons";

export function BriefTab({
  briefs,
  onAnalyzed,
  onBriefsChanged,
}: {
  briefs: ChannelBrief[] | null;
  onAnalyzed: () => void;
  onBriefsChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText((prev) => (prev ? `${prev}\n\n${content}` : content));
    e.target.value = "";
  }

  async function handleAnalyze() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const { topics } = await analyzeChannelBrief(text);
      const categories = new Set(topics.map((t) => t.category)).size;
      setResult(`Added ${topics.length} topic${topics.length === 1 ? "" : "s"} across ${categories} categor${categories === 1 ? "y" : "ies"} to your library.`);
      setText("");
      onAnalyzed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Paste or upload your channel brief</h3>
        <div className="hint" style={{ display: "block", marginBottom: 10 }}>
          Describe your channel idea, the categories you want to cover, and any specific topics or notes you already
          have. The more detail the better, but even a rough sketch works — it fills gaps with its own expertise in
          the niche rather than just echoing the brief back.
        </div>
        <textarea
          className="textarea"
          rows={10}
          placeholder={
            "e.g. A channel about personal finance for people in their 20s.\n\n" +
            "Categories I want to cover:\n- Budgeting basics\n- Investing myths\n- Debt payoff stories\n\n" +
            "Specific ideas: how compound interest works, why my rent is 'too high', ..."
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            style={{ display: "none" }}
            onChange={handleFile}
          />
          <button className="btn sm ghost" onClick={() => fileInputRef.current?.click()}>
            Upload .txt/.md
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={handleAnalyze} disabled={busy || !text.trim()}>
            {busy ? "Analyzing…" : "Analyze & build library"}
          </button>
        </div>
        {result && <div className="notice" style={{ marginTop: 12 }}>✓ {result}</div>}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      <div className="card">
        <h3>Past briefs</h3>
        {briefs === null ? (
          <div className="empty">Loading…</div>
        ) : briefs.length === 0 ? (
          <div className="empty">No briefs analyzed yet — the one you submit above will show up here.</div>
        ) : (
          <div className="ref-list">
            {briefs.map((b) => (
              <div className="ref-item" key={b.id}>
                <div className="ref-main">
                  <div className="t">
                    {b.rawText.length > 140 ? `${b.rawText.slice(0, 140)}…` : b.rawText}
                  </div>
                  <div className="hint">
                    {b.topicCount ?? 0} topics · {new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="ref-actions">
                  <button className="btn sm ghost" onClick={() => setText(b.rawText)} title="Load this text back into the box above">
                    Reuse
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={async () => {
                      await deleteChannelBrief(b.id);
                      onBriefsChanged();
                    }}
                    title="Delete"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
