import { useEffect, useState } from "react";
import { listLibraryTopics, listChannelBriefs, listCalendarSlots } from "../../db";
import type { LibraryTopic, ChannelBrief, CalendarSlot } from "../../db";
import { BriefTab } from "./BriefTab";
import { LibraryTab } from "./LibraryTab";
import { CalendarTab } from "./CalendarTab";

type TabId = "brief" | "library" | "calendar";
const TABS: { id: TabId; label: string }[] = [
  { id: "brief", label: "Channel Brief" },
  { id: "library", label: "Library" },
  { id: "calendar", label: "Calendar" },
];

/** Content Calendar: dump a channel brief -> a categorized Topic Library ->
 *  an auto-planned (or hand-scheduled) Calendar. State is lifted here so all
 *  three tabs stay in sync without refetching on every tab switch. */
export function ContentCalendar() {
  const [tab, setTab] = useState<TabId>("library");
  const [topics, setTopics] = useState<LibraryTopic[] | null>(null);
  const [briefs, setBriefs] = useState<ChannelBrief[] | null>(null);
  const [slots, setSlots] = useState<CalendarSlot[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  const refreshTopics = () => listLibraryTopics().then(setTopics).catch((e) => setLoadError(e.message));
  const refreshBriefs = () => listChannelBriefs().then(setBriefs).catch((e) => setLoadError(e.message));
  const refreshSlots = () => listCalendarSlots().then(setSlots).catch((e) => setLoadError(e.message));

  useEffect(() => {
    refreshTopics();
    refreshBriefs();
    refreshSlots();
  }, []);

  return (
    <div className="panel-wrap">
      <div className="panel-head">
        <div>
          <h2>Content Calendar</h2>
          <div className="desc">
            Dump your channel idea into a Brief and it builds a categorized Topic Library for you — then plan a
            posting schedule automatically, or pick topics by hand and place them on any date.
          </div>
        </div>
      </div>

      <div className="tab-row">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "library" && topics && topics.length > 0 && <span className="tab-count">{topics.length}</span>}
            {t.id === "calendar" && slots && slots.length > 0 && <span className="tab-count">{slots.length}</span>}
          </button>
        ))}
      </div>

      {loadError && <div className="error-box" style={{ marginBottom: 16 }}>{loadError}</div>}

      {tab === "brief" && (
        <BriefTab
          briefs={briefs}
          onAnalyzed={() => {
            refreshTopics();
            refreshBriefs();
            setTab("library");
          }}
          onBriefsChanged={refreshBriefs}
        />
      )}
      {tab === "library" && (
        <LibraryTab
          topics={topics}
          onTopicsChanged={refreshTopics}
          onScheduled={() => {
            refreshTopics();
            refreshSlots();
            setTab("calendar");
          }}
        />
      )}
      {tab === "calendar" && (
        <CalendarTab
          slots={slots}
          topics={topics}
          onSlotsChanged={() => {
            refreshSlots();
            refreshTopics();
          }}
        />
      )}
    </div>
  );
}
