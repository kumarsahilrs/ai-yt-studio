import { useMemo, useState } from "react";
import { putLibraryTopic, deleteLibraryTopic, putCalendarSlot } from "../../db";
import type { LibraryTopic, CalendarSlot } from "../../db";
import { planCalendarFromTopics, newId, todayISO } from "../../planner";
import { IconTrash, IconCalendar } from "../../icons";

const STATUS_LABEL: Record<LibraryTopic["status"], string> = {
  idea: "Idea",
  scheduled: "Scheduled",
  done: "Done",
};

export function LibraryTab({
  topics,
  onTopicsChanged,
  onScheduled,
}: {
  topics: LibraryTopic[] | null;
  onTopicsChanged: () => void;
  onScheduled: () => void;
}) {
  const [search, setSearch] = useState("");
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(todayISO());

  const filtered = useMemo(() => {
    if (!topics) return null;
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (t) => t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || (t.angle || "").toLowerCase().includes(q),
    );
  }, [topics, search]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const map = new Map<string, LibraryTopic[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  async function scheduleTopic(topic: LibraryTopic, date: string) {
    const now = Date.now();
    const slot: CalendarSlot = {
      id: newId("slot"),
      date,
      title: topic.title,
      category: topic.category,
      platforms: topic.platforms,
      topicId: topic.id,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    };
    await putCalendarSlot(slot);
    await putLibraryTopic({ ...topic, status: "scheduled" });
    setSchedulingId(null);
    onScheduled();
  }

  async function removeTopic(id: string) {
    await deleteLibraryTopic(id);
    onTopicsChanged();
  }

  return (
    <div>
      <AddTopicCard onAdded={onTopicsChanged} />
      <AutoPlanCard topics={topics} onPlanned={onScheduled} />

      <div className="card">
        <h3>Topics ({topics?.length ?? 0})</h3>
        <div className="field" style={{ marginBottom: 14 }}>
          <input
            className="input"
            placeholder="Search topics, categories, angles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {grouped === null ? (
          <div className="empty">Loading…</div>
        ) : grouped.length === 0 ? (
          <div className="empty">
            {topics?.length ? "No topics match that search." : "No topics yet — add one below, or analyze a Channel Brief."}
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category} style={{ marginBottom: 18 }}>
              <div className="section-title" style={{ margin: "0 0 8px" }}>{category}</div>
              <div className="ref-list">
                {items.map((t) => (
                  <div className="ref-item" key={t.id}>
                    <div className="ref-main">
                      <div className="row" style={{ gap: 8 }}>
                        <span className="t">{t.title}</span>
                        <span className="pill">{STATUS_LABEL[t.status]}</span>
                      </div>
                      {t.angle && <div className="hint">{t.angle}</div>}
                      {schedulingId === t.id && (
                        <div className="row" style={{ marginTop: 8, gap: 8 }}>
                          <input
                            className="input"
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            style={{ width: 160 }}
                          />
                          <button className="btn sm primary" onClick={() => scheduleTopic(t, scheduleDate)}>
                            Confirm
                          </button>
                          <button className="btn sm ghost" onClick={() => setSchedulingId(null)}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="ref-actions">
                      {schedulingId !== t.id && (
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setScheduleDate(todayISO());
                            setSchedulingId(t.id);
                          }}
                          title="Schedule to a date"
                        >
                          <IconCalendar size={13} /> Schedule
                        </button>
                      )}
                      <button className="btn sm ghost" onClick={() => removeTopic(t.id)} title="Delete">
                        <IconTrash size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AddTopicCard({ onAdded }: { onAdded: () => void }) {
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!category.trim() || !title.trim()) return;
    setBusy(true);
    try {
      await putLibraryTopic({
        id: newId("topic"),
        category: category.trim(),
        title: title.trim(),
        angle: angle.trim() || undefined,
        status: "idea",
        createdAt: Date.now(),
      });
      setCategory("");
      setTitle("");
      setAngle("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Add a topic by hand</h3>
      <div className="wire-row">
        <div className="field" style={{ minWidth: 160 }}>
          <label>Category</label>
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Budgeting basics" />
        </div>
        <div className="field grow">
          <label>Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How compound interest quietly builds wealth" />
        </div>
        <div className="field grow">
          <label>Angle (optional)</label>
          <input className="input" value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Why this works / what makes it different" />
        </div>
        <button className="btn primary" onClick={add} disabled={busy || !category.trim() || !title.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

function AutoPlanCard({ topics, onPlanned }: { topics: LibraryTopic[] | null; onPlanned: () => void }) {
  const [perWeek, setPerWeek] = useState(3);
  const [weeks, setWeeks] = useState(4);
  const [startDate, setStartDate] = useState(todayISO());
  const [scope, setScope] = useState<"idea" | "all">("idea");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();

  const candidates = (topics || []).filter((t) => scope === "all" || t.status === "idea");

  async function plan() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const { slots } = await planCalendarFromTopics(candidates, { perWeek, weeks, startDate });
      setResult(`Scheduled ${slots.length} video${slots.length === 1 ? "" : "s"} — switching to the Calendar tab.`);
      onPlanned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Auto-plan a calendar from these topics</h3>
      <div className="hint" style={{ display: "block", marginBottom: 10 }}>
        Picks from {candidates.length} {scope === "all" ? "topic(s)" : "unscheduled idea topic(s)"}, spaces them out
        across the week, varies categories, and gives a reason for each placement.
      </div>
      <div className="wire-row">
        <div className="field" style={{ width: 120 }}>
          <label>Videos / week</label>
          <input className="input" type="number" min={1} max={14} value={perWeek} onChange={(e) => setPerWeek(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Weeks to plan</label>
          <input className="input" type="number" min={1} max={26} value={weeks} onChange={(e) => setWeeks(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>Start date</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>Include</label>
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value as "idea" | "all")}>
            <option value="idea">Unscheduled ideas only</option>
            <option value="all">All topics</option>
          </select>
        </div>
        <button className="btn primary" onClick={plan} disabled={busy || candidates.length === 0}>
          {busy ? "Planning…" : "Plan calendar"}
        </button>
      </div>
      {result && <div className="notice" style={{ marginTop: 12 }}>✓ {result}</div>}
      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
