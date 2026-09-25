import { useEffect, useState } from "react";
import { getState, hasUnsavedKeys, useStore } from "./store";
import { runAll, cancelStage } from "./engine";
import { STAGES } from "./stages";
import { Sidebar } from "./components/Sidebar";
import { InputsBar } from "./components/InputsBar";
import { StagePanel } from "./components/StagePanel";
import { Settings } from "./components/Settings";

export function App() {
  const view = useStore((s) => s.view);
  const [running, setRunning] = useState(false);

  // Unsaved keys only live in browser storage, which can be wiped — ask before leaving.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (getState().keys.mode === "disk" && hasUnsavedKeys()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function onRunAll() {
    setRunning(true);
    try {
      await runAll();
    } finally {
      setRunning(false);
    }
  }

  function onStopAll() {
    STAGES.forEach((s) => cancelStage(s.id));
    setRunning(false);
  }

  return (
    <div className="app">
      <Sidebar running={running} onRunAll={onRunAll} onStopAll={onStopAll} />
      <main className="main">
        {view !== "settings" && <InputsBar />}
        {view === "settings" ? <Settings /> : <StagePanel stageId={view} />}
      </main>
    </div>
  );
}
