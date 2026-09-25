import type { ReactNode } from "react";
import { providersFor, TIER_LABEL } from "../providers";
import { useStore, setSecret, saveKeys, hasUnsavedKeys, setCreditLimit, resetCreditUsage } from "../store";
import { FieldEditor } from "./FieldEditor";
import { IconCheck, IconExternal, IconRefresh } from "../icons";
import type { StageKind } from "../types";

const KINDS: { kind: StageKind; label: string }[] = [
  { kind: "llm", label: "Text / LLM" },
  { kind: "image", label: "Images" },
  { kind: "video", label: "Video (credit-based)" },
  { kind: "tts", label: "Voice / TTS" },
];

export function Settings() {
  const secrets = useStore((s) => s.secrets);

  return (
    <div className="panel-wrap">
      <div className="panel-head">
        <div>
          <h2>Settings &amp; API keys</h2>
          <div className="desc">
            Add a key once here and it’s available to every stage that uses that provider. Click <b>Save keys</b> to
            store them in a file on this computer (in your user folder, not the OneDrive-synced project), so they come
            back after a refresh or restart. Keys are only ever sent to the provider itself, through the local proxy.
            Pick which provider each stage uses (and its model/prompt) on the stage’s own panel.
          </div>
        </div>
      </div>

      <SaveKeysBar />

      {KINDS.map(({ kind, label }) => (
        <div key={kind}>
          <div className="section-title">{label}</div>
          <div className="settings-grid">
            {providersFor(kind).map((p) => {
              const cfg = secrets[p.id] || {};
              return (
                <div className="provider-card" key={p.id}>
                  <div className="head">
                    <span className={"badge " + p.tier}>{TIER_LABEL[p.tier]}</span>
                    <span className="name">{p.name}</span>
                    {p.note && <span className="pill">{p.note}</span>}
                    <span className="kind">
                      {p.signupUrl && (
                        <a className="link-ext" href={p.signupUrl} target="_blank" rel="noreferrer">
                          Get key <IconExternal size={12} />
                        </a>
                      )}
                    </span>
                  </div>
                  {p.secrets.length === 0 ? (
                    <div className="pill" style={{ display: "inline-block" }}>
                      {p.needsBackend ? "No key — but needs the Phase-2 backend" : "No API key required"}
                    </div>
                  ) : (
                    <div className="fields-row">
                      {p.secrets.map((f) => (
                        <FieldEditor
                          key={f.key}
                          field={f}
                          value={cfg[f.key] ?? ""}
                          onChange={(v) => setSecret(p.id, f.key, v)}
                        />
                      ))}
                    </div>
                  )}
                  {kind === "video" && <CreditTracker providerId={p.id} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="notice" style={{ marginTop: 26 }}>
        <b>Recommended free starting stack:</b> Gemini (text) → Pollinations (images, no key) → Browser Web Speech
        (voice). That gets you a full run with just one free Gemini key. Add ElevenLabs or the Edge-TTS backend later
        for downloadable, higher-quality narration.
      </div>
    </div>
  );
}

/** Manual usage tracking for a credit-based (mainly video) provider: the creator
 *  records the trial credits they were given, and the app counts down as
 *  generations succeed — so the Video stage can warn/disable before a call
 *  that's just going to fail on an empty account. */
function CreditTracker({ providerId }: { providerId: string }) {
  const credit = useStore((s) => s.credits[providerId]);
  const limit = credit?.limit;
  const used = credit?.used ?? 0;
  const remaining = limit === undefined ? undefined : Math.max(0, limit - used);

  return (
    <div className="credit-tracker">
      <div className="field" style={{ maxWidth: 200 }}>
        <label>Free credits given</label>
        <input
          className="input"
          type="number"
          min={0}
          placeholder="not tracked"
          value={limit ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            setCreditLimit(providerId, v === "" ? undefined : Math.max(0, Number(v)));
          }}
        />
      </div>
      {limit === undefined ? (
        <span className="hint">
          Set the trial credits this provider gave you at signup to get a low/no-credit warning here.
        </span>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <span className={"pill" + (remaining === 0 ? " danger" : "")}>
            {used} used · {remaining} left
          </span>
          <button className="btn sm ghost" onClick={() => resetCreditUsage(providerId)} title="Reset usage to 0 (e.g. after topping up)">
            <IconRefresh size={12} /> Reset
          </button>
        </div>
      )}
    </div>
  );
}

/** Sticky bar at the top of Settings: shows whether keys are saved and saves them. */
function SaveKeysBar() {
  const keys = useStore((s) => s.keys);
  const unsaved = useStore((s) => hasUnsavedKeys(s));

  let status: ReactNode;
  if (keys.mode === "loading") status = "Loading saved keys…";
  else if (keys.error) status = <span className="save-error">{keys.error}</span>;
  else if (unsaved) status = (<><b>Unsaved changes</b> — save so your keys survive a refresh or restart.</>);
  else if (keys.mode === "browser")
    status = (<>Saved in this browser only, which can be wiped. Run the app with <code>npm run dev</code> to save keys to a file.</>);
  else if (keys.savedSnapshot === "{}") status = "No keys saved yet — add one below, then click Save keys.";
  else status = `All keys saved${keys.savedAt ? ` at ${new Date(keys.savedAt).toLocaleTimeString()}` : ""}.`;

  return (
    <div className={"save-bar" + (unsaved ? " unsaved" : "")} role="status">
      <div className="save-status">
        <div>{status}</div>
        {keys.mode === "disk" && keys.path && (
          <div className="save-path">
            File: <code>{keys.path}</code>
          </div>
        )}
      </div>
      <button
        className="btn primary"
        disabled={!unsaved || keys.saving || keys.mode === "loading"}
        onClick={() => saveKeys()}
      >
        {keys.saving ? "Saving…" : unsaved ? "Save keys" : (<><IconCheck size={15} /> Saved</>)}
      </button>
    </div>
  );
}
