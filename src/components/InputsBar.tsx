import { useStore, setInputs } from "../store";
import { PLATFORMS } from "../stages";
import type { AspectRatio, Platform } from "../types";

export function InputsBar() {
  const inputs = useStore((s) => s.inputs);
  const platforms = inputs.platforms || [];

  function togglePlatform(id: Platform) {
    const next = platforms.includes(id) ? platforms.filter((p) => p !== id) : [...platforms, id];
    setInputs({ platforms: next });
  }

  return (
    <div className="inputs-bar">
      <div className="field grow">
        <label>Topic</label>
        <input
          className="input"
          placeholder="e.g. How compound interest quietly builds wealth"
          value={inputs.topic}
          onChange={(e) => setInputs({ topic: e.target.value })}
        />
      </div>
      <div className="field f-dims">
        <label>Dimensions</label>
        <select
          className="select"
          value={inputs.dimensions}
          onChange={(e) => setInputs({ dimensions: e.target.value as AspectRatio })}
        >
          <option value="16:9">16:9 — landscape</option>
          <option value="9:16">9:16 — shorts/reels</option>
          <option value="1:1">1:1 — square</option>
        </select>
      </div>
      <div className="field f-duration">
        <label>Duration</label>
        <input
          className="input"
          value={inputs.duration}
          onChange={(e) => setInputs({ duration: e.target.value })}
        />
      </div>
      <div className="field f-audience">
        <label>Audience type</label>
        <input
          className="input"
          placeholder="Beginners, Investors…"
          value={inputs.audienceType}
          onChange={(e) => setInputs({ audienceType: e.target.value })}
        />
      </div>
      <div className="field f-age">
        <label>Age group</label>
        <input
          className="input"
          placeholder="18-34"
          value={inputs.ageGroup}
          onChange={(e) => setInputs({ ageGroup: e.target.value })}
        />
      </div>
      <div className="field f-platforms">
        <label>Publish target(s)</label>
        <div className="platform-row">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"platform-chip" + (platforms.includes(p.id) ? " active" : "")}
              onClick={() => togglePlatform(p.id)}
              title={p.note}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
