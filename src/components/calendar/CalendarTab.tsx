import { useMemo, useState } from "react";
import { putCalendarSlot, deleteCalendarSlot, putLibraryTopic } from "../../db";
import type { CalendarSlot, LibraryTopic } from "../../db";
import { setInputs, setView } from "../../store";
import { todayISO } from "../../planner";
import { IconTrash, IconCheck, IconPlay } from "../../icons";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 6 weeks (42 days) starting on the Sunday on/before the 1st of `cursor`'s
 *  month, so the grid always fully tiles — some cells fall outside the month. */
function buildMonthGrid(cursor: Date): { date: string; inMonth: boolean }[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      inMonth: d.getMonth() === month,
    };
  });
}

const STATUS_DOT: Record<CalendarSlot["status"], string> = {
  planned: "idle",
  "in-progress": "running",
  done: "done",
};

export function CalendarTab({
  slots,
  topics,
  onSlotsChanged,
}: {
  slots: CalendarSlot[] | null;
  topics: LibraryTopic[] | null;
  onSlotsChanged: () => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarSlot[]>();
    for (const s of slots || []) {
      if (!m.has(s.date)) m.set(s.date, []);
      m.get(s.date)!.push(s);
    }
    return m;
  }, [slots]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = todayISO();
  const selected = selectedId ? (slots || []).find((s) => s.id === selectedId) : undefined;

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  if (slots === null) return <div className="card"><div className="empty">Loading…</div></div>;

  return (
    <div>
      <div className="card">
        <div className="row" style={{ marginBottom: 14, justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm ghost" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="t" style={{ minWidth: 150, textAlign: "center" }}>{monthLabel}</span>
            <button className="btn sm ghost" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <button className="btn sm ghost" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </button>
        </div>

        {slots.length === 0 ? (
          <div className="empty">No scheduled videos yet — schedule a topic from the Library tab.</div>
        ) : (
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div className="cal-weekday" key={w}>{w}</div>
            ))}
            {grid.map(({ date, inMonth }) => {
              const daySlots = byDate.get(date) || [];
              return (
                <div key={date} className={"cal-cell" + (inMonth ? "" : " out") + (date === today ? " today" : "")}>
                  <div className="cal-daynum">{Number(date.slice(-2))}</div>
                  {daySlots.map((s) => (
                    <button
                      key={s.id}
                      className={"cal-slot" + (selectedId === s.id ? " active" : "")}
                      onClick={() => setSelectedId(s.id)}
                      title={s.title}
                    >
                      <span className={"dot " + STATUS_DOT[s.status]} />
                      {s.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <SlotDetail
          slot={selected}
          topic={topics?.find((t) => t.id === selected.topicId)}
          onClose={() => setSelectedId(null)}
          onChanged={onSlotsChanged}
        />
      )}
    </div>
  );
}

function SlotDetail({
  slot,
  topic,
  onClose,
  onChanged,
}: {
  slot: CalendarSlot;
  topic?: LibraryTopic;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newDate, setNewDate] = useState(slot.date);
  const [busy, setBusy] = useState(false);

  async function reschedule() {
    if (newDate === slot.date) return;
    setBusy(true);
    try {
      await putCalendarSlot({ ...slot, date: newDate, updatedAt: Date.now() });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: CalendarSlot["status"]) {
    setBusy(true);
    try {
      await putCalendarSlot({ ...slot, status, updatedAt: Date.now() });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeFromCalendar() {
    setBusy(true);
    try {
      await deleteCalendarSlot(slot.id);
      if (topic && topic.status === "scheduled") await putLibraryTopic({ ...topic, status: "idea" });
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function startThisVideo() {
    const patch: Parameters<typeof setInputs>[0] = { topic: slot.title + (topic?.angle ? ` — ${topic.angle}` : "") };
    if (slot.platforms && slot.platforms.length) patch.platforms = slot.platforms;
    setInputs(patch);
    void setStatus("in-progress");
    setView("research");
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{slot.title}</h3>
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {slot.category && <span className="pill">{slot.category}</span>}
        <span className="pill">{slot.status}</span>
        {(slot.platforms || []).map((p) => (
          <span className="pill" key={p}>{p}</span>
        ))}
      </div>
      {slot.rationale && <div className="hint" style={{ display: "block", marginBottom: 12 }}>Why this slot: {slot.rationale}</div>}

      <div className="wire-row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ width: 170 }}>
          <label>Date</label>
          <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </div>
        <button className="btn sm" onClick={reschedule} disabled={busy || newDate === slot.date}>
          Save new date
        </button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" onClick={startThisVideo} disabled={busy}>
          <IconPlay size={13} /> Start this video
        </button>
        {slot.status !== "done" && (
          <button className="btn sm ghost" onClick={() => setStatus("done")} disabled={busy}>
            <IconCheck size={12} /> Mark done
          </button>
        )}
        <button className="btn sm ghost" onClick={removeFromCalendar} disabled={busy} title="Remove from calendar">
          <IconTrash size={12} /> Remove
        </button>
      </div>
    </div>
  );
}
