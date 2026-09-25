import { getState } from "./store";
import { withFallback } from "./engine";
import { putChannelBrief, putLibraryTopics, putCalendarSlots } from "./db";
import type { LibraryTopic, CalendarSlot } from "./db";
import type { RunContext } from "./types";

// ---------------------------------------------------------------------------
// Content Calendar planning: turns a pasted/uploaded channel brief into a
// categorized Topic Library, and turns a set of library topics into a dated
// calendar. Both reuse the Research stage's wired provider (and its
// automatic fallback chain, via engine.ts's withFallback) as the "planning
// brain" — no separate provider-selection UI needed for this.
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Today, local time, as YYYY-MM-DD (not UTC — avoids an off-by-one near midnight). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function makePlanningCtx(): RunContext {
  // config is filled in per-attempt by withFallback; width/height are unused by text providers.
  return { config: {}, inputs: getState().inputs, width: 0, height: 0 };
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

// --- Channel Brief -> Topic Library ------------------------------------------

const BRIEF_SYSTEM_PROMPT =
  `You are a YouTube/social content strategist. A creator has described their channel idea, content ` +
  `categories, and rough topics below. Organize it into clear content categories (pillars) and specific, ` +
  `actionable video topic ideas within each.\n\n` +
  `Rules:\n` +
  `- Extract everything usable from the brief. If it's sparse, use your own expertise in this niche to ` +
  `propose reasonable topics that fit the stated channel idea — don't just echo the brief back.\n` +
  `- Titles must be specific and compelling, not vague ("5 signs your..." beats "About budgeting").\n` +
  `- Identify at least 2-3 categories unless the brief is unmistakably about only one, and give each ` +
  `category 4-8 topics.\n\n` +
  `Return ONLY a JSON array (no prose, no code fences) where each element is:\n` +
  `{\n` +
  `  "category": "<a content category/pillar name>",\n` +
  `  "topics": [\n` +
  `    { "title": "<a specific video topic>", "angle": "<one sentence: the unique angle, or why this topic works now>" }\n` +
  `  ]\n` +
  `}`;

function parseBriefAnalysis(text: string): { category: string; topics: { title: string; angle?: string }[] }[] {
  const t = stripFences(text);
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Could not find a JSON array in the model output.");
  const arr = JSON.parse(t.slice(start, end + 1));
  return arr
    .map((c: any) => ({
      category: String(c.category ?? "General").trim() || "General",
      topics: Array.isArray(c.topics)
        ? c.topics
            .map((tp: any) => ({ title: String(tp.title ?? "").trim(), angle: tp.angle ? String(tp.angle).trim() : undefined }))
            .filter((tp: { title: string }) => tp.title)
        : [],
    }))
    .filter((c: any) => c.topics.length > 0);
}

/** Analyzes a pasted/uploaded channel brief into categorized library topics,
 *  saves the brief and the topics, and returns them. */
export async function analyzeChannelBrief(rawText: string): Promise<{ topics: LibraryTopic[]; providerId: string }> {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("Paste or upload your channel brief first.");

  const ctx = makePlanningCtx();
  const { result, providerId } = await withFallback(
    "research",
    "llm",
    (p, c) => p.runLlm!(BRIEF_SYSTEM_PROMPT, trimmed, c),
    ctx,
  );
  const parsed = parseBriefAnalysis(result.text);
  if (parsed.length === 0) throw new Error("The model didn't return any usable categories/topics — try rephrasing the brief.");

  const briefId = newId("brief");
  const now = Date.now();
  const topics: LibraryTopic[] = parsed.flatMap((cat) =>
    cat.topics.map((t) => ({
      id: newId("topic"),
      category: cat.category,
      title: t.title,
      angle: t.angle,
      status: "idea" as const,
      createdAt: now,
      sourceBriefId: briefId,
    })),
  );

  await putChannelBrief({ id: briefId, rawText: trimmed, createdAt: now, analyzedAt: now, topicCount: topics.length });
  await putLibraryTopics(topics);
  return { topics, providerId };
}

// --- Topic Library -> Calendar -----------------------------------------------

const SCHEDULER_SYSTEM_PROMPT =
  `You are a content calendar planner. Given a list of video topic ideas (each with a category) and a ` +
  `target posting frequency, build a realistic publishing schedule.\n\n` +
  `Rules:\n` +
  `- Publish {{perWeek}} time(s) per week for {{weeks}} week(s), starting from {{startDate}} (YYYY-MM-DD) or later.\n` +
  `- Spread posting days evenly across each week rather than clustering them.\n` +
  `- Vary categories across consecutive slots rather than repeating the same one back to back.\n` +
  `- Use each topic id AT MOST once, and only ids from the list below — never invent one.\n` +
  `- If there are more slots than topics, stop early (fewer, fully-used slots beats padding). If there ` +
  `are more topics than slots, pick the strongest ones.\n` +
  `- Give a one-sentence rationale for each placement: why this topic on this date (variety, sequencing, momentum).\n\n` +
  `Return ONLY a JSON array (no prose, no code fences) where each element is:\n` +
  `{ "date": "YYYY-MM-DD", "topicId": "<exact id from the list>", "rationale": "<one sentence>" }\n\n` +
  `Topics (JSON):\n{{topicsJson}}`;

function parseSchedule(text: string): { date: string; topicId: string; rationale?: string }[] {
  const t = stripFences(text);
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Could not find a JSON array in the model output.");
  const arr = JSON.parse(t.slice(start, end + 1));
  return arr
    .map((p: any) => ({
      date: String(p.date ?? "").trim(),
      topicId: String(p.topicId ?? p.id ?? "").trim(),
      rationale: p.rationale ? String(p.rationale).trim() : undefined,
    }))
    .filter((p: { date: string; topicId: string }) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.topicId);
}

/** Proposes calendar placements for the given library topics and saves them as
 *  CalendarSlots. Scheduled topics are marked "scheduled" so the Library view
 *  can tell them apart from ones still waiting for a slot. */
export async function planCalendarFromTopics(
  topics: LibraryTopic[],
  opts: { perWeek: number; weeks: number; startDate: string },
): Promise<{ slots: CalendarSlot[]; providerId: string }> {
  if (topics.length === 0) throw new Error("No topics to schedule — add some to the library first.");
  const system = SCHEDULER_SYSTEM_PROMPT.replaceAll("{{perWeek}}", String(opts.perWeek))
    .replaceAll("{{weeks}}", String(opts.weeks))
    .replaceAll("{{startDate}}", opts.startDate)
    .replaceAll(
      "{{topicsJson}}",
      JSON.stringify(topics.map((t) => ({ id: t.id, category: t.category, title: t.title, angle: t.angle }))),
    );

  const ctx = makePlanningCtx();
  const { result, providerId } = await withFallback(
    "research",
    "llm",
    (p, c) => p.runLlm!(system, "Build the schedule now.", c),
    ctx,
  );
  const placements = parseSchedule(result.text);
  if (placements.length === 0) throw new Error("The model didn't place any topics — try again, or a shorter horizon.");

  const byId = new Map(topics.map((t) => [t.id, t]));
  const now = Date.now();
  const seen = new Set<string>();
  const slots: CalendarSlot[] = [];
  for (const pl of placements) {
    if (seen.has(pl.topicId)) continue; // guard against the model reusing an id despite the rule
    const topic = byId.get(pl.topicId);
    if (!topic) continue;
    seen.add(pl.topicId);
    slots.push({
      id: newId("slot"),
      date: pl.date,
      title: topic.title,
      category: topic.category,
      platforms: topic.platforms,
      topicId: topic.id,
      rationale: pl.rationale,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
  }
  if (slots.length === 0) throw new Error("The model's placements didn't match any given topic ids — try again.");

  await putCalendarSlots(slots);
  await putLibraryTopics(slots.map((s) => ({ ...byId.get(s.topicId!)!, status: "scheduled" as const })));
  return { slots, providerId };
}
