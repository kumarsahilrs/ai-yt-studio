import { useEffect, useState } from "react";
import { useStore, saveProjectAs, loadSavedProject, listSavedProjects, deleteProject } from "../store";
import type { ProjectRecord } from "../store";
import { IconFolder, IconTrash } from "../icons";

/** Projects panel: the current work autosaves continuously (see store.ts's
 *  scheduleAutosave), so this is really about named snapshots — saving one to
 *  come back to later, or to keep more than one video going at once. */
export function Projects() {
  const activeProjectName = useStore((s) => s.activeProjectName);
  const [name, setName] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // a project id, or "save"
  const [error, setError] = useState<string | undefined>();

  async function refresh() {
    try {
      setProjects(await listSavedProjects());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSave() {
    setBusy("save");
    setError(undefined);
    try {
      await saveProjectAs(name || activeProjectName || "Untitled");
      setName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleLoad(id: string) {
    setBusy(id);
    setError(undefined);
    try {
      await loadSavedProject(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this saved project? This can't be undone.")) return;
    setBusy(id);
    setError(undefined);
    try {
      await deleteProject(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel-wrap">
      <div className="panel-head">
        <div>
          <h2>Projects</h2>
          <div className="desc">
            Your work autosaves continuously in this browser — inputs, provider wiring, and every stage's output,
            including generated images, audio and video. Save it as a named project below to come back to it later,
            or to keep more than one video going at once.
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Current work</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="pill">
            {activeProjectName ? `Loaded from: ${activeProjectName}` : "Untitled — autosaving in this browser only"}
          </span>
        </div>
        <div className="wire-row">
          <div className="field grow">
            <label>Save as</label>
            <input
              className="input"
              placeholder={activeProjectName || "Project name…"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <button className="btn primary" onClick={handleSave} disabled={busy === "save"}>
            <IconFolder size={14} /> {busy === "save" ? "Saving…" : "Save as new project"}
          </button>
        </div>
        {error && (
          <div className="error-box" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Saved projects</h3>
        {projects === null ? (
          <div className="empty">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="empty">No saved projects yet — save your current work above to see it here.</div>
        ) : (
          <div className="ref-list">
            {projects.map((p) => (
              <div className="ref-item" key={p.id}>
                <div className="ref-main">
                  <div className="t">{p.name}</div>
                  <div className="hint">
                    {p.inputs?.topic ? `“${p.inputs.topic}” · ` : ""}
                    Saved {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="ref-actions">
                  <button className="btn sm" onClick={() => handleLoad(p.id)} disabled={!!busy}>
                    {busy === p.id ? "Loading…" : "Load"}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => handleDelete(p.id)}
                    disabled={!!busy}
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
