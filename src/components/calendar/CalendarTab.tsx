import type { CalendarSlot, LibraryTopic } from "../../db";

// TODO(task #13): month grid, slot detail/edit/reschedule/unschedule, "Start this video" pipeline handoff.
export function CalendarTab({
  slots,
  topics,
  onSlotsChanged,
}: {
  slots: CalendarSlot[] | null;
  topics: LibraryTopic[] | null;
  onSlotsChanged: () => void;
}) {
  void topics;
  void onSlotsChanged;
  return (
    <div className="card">
      <h3>Calendar</h3>
      {slots === null ? (
        <div className="empty">Loading…</div>
      ) : slots.length === 0 ? (
        <div className="empty">No scheduled videos yet — schedule a topic from the Library tab.</div>
      ) : (
        <div className="ref-list">
          {slots.map((s) => (
            <div className="ref-item" key={s.id}>
              <div className="ref-main">
                <div className="t">{s.date} — {s.title}</div>
                {s.rationale && <div className="hint">{s.rationale}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
