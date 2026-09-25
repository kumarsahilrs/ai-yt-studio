import type { StageDef, ProjectInputs, Platform, PublishPlan } from "./types";

/** Publish targets the creator can select — drives the Publish & Metadata
 *  stage (one generated block per platform picked) and lightly informs
 *  Research/Scriptwriter (hook pacing differs by platform). */
export const PLATFORMS: { id: Platform; label: string; note: string }[] = [
  { id: "youtube", label: "YouTube (long-form)", note: "Searchable title + keyword-rich description matter most" },
  { id: "youtube-shorts", label: "YouTube Shorts", note: "Vertical, hook in the first second, short punchy title" },
  { id: "instagram-reels", label: "Instagram Reels", note: "Caption doubles as the hook; 3-5 targeted hashtags beat 30" },
  { id: "tiktok", label: "TikTok", note: "On-screen text hook + a handful of niche + broad hashtags" },
];

// ---------------------------------------------------------------------------
// Pipeline definition. Each stage has a kind (which decides the provider menu)
// and, for LLM stages, an editable default system prompt.
//
// {{topic}}, {{dimensions}}, {{duration}}, {{audienceType}}, {{ageGroup}} are
// substituted from the project inputs before sending.
// ---------------------------------------------------------------------------

export const STAGES: StageDef[] = [
  {
    id: "research",
    title: "Research & Hook",
    kind: "llm",
    short: "Hooks + outline",
    description:
      "Analyzes the audience and age group, then proposes high-retention hooks and a structural outline tuned to the target duration.",
    defaultSystemPrompt:
      `You are an expert YouTube strategist and audience psychologist.\n` +
      `Given the topic, audience type, and age group, reason about what makes THIS demographic keep watching.\n\n` +
      `Output in clean Markdown:\n` +
      `1. **Audience insight** — 2-3 sentences on what this group cares about and their attention triggers.\n` +
      `2. **3 hook options** — each a punchy first line (<= 12 words) with a one-line note on why it works.\n` +
      `3. **Recommended hook** — pick one and say why.\n` +
      `4. **Structural outline** — beat-by-beat sections with rough timestamps that fit a {{duration}} video.\n\n` +
      `Topic: {{topic}}\nAudience type: {{audienceType}}\nAge group: {{ageGroup}}\nDuration: {{duration}}\nFormat/aspect: {{dimensions}}`,
  },
  {
    id: "script",
    title: "Scriptwriter",
    kind: "llm",
    short: "Full spoken script",
    description:
      "Turns the chosen hook and outline into a word-for-word spoken script, paced to the target duration and voiced for the audience.",
    defaultSystemPrompt:
      `You are a world-class short-form scriptwriter.\n` +
      `Using the research/outline provided by the user, write a COMPLETE word-for-word narration script.\n\n` +
      `Rules:\n` +
      `- Open with the recommended hook in the first 3 seconds.\n` +
      `- Tone must fit a {{ageGroup}} {{audienceType}} audience.\n` +
      `- Pace it to be read aloud in about {{duration}} (roughly 150 spoken words per minute).\n` +
      `- Write ONLY the spoken words — no scene directions, no camera notes, no headings.\n` +
      `- Conversational, punchy sentences. End with a clear call-to-action.\n\n` +
      `Topic: {{topic}}`,
  },
  {
    id: "visuals",
    title: "Visual Director",
    kind: "llm",
    short: "Scene-by-scene breakdown",
    description:
      "Breaks the script into scenes and writes a descriptive text-to-image prompt for each, matched to your aspect ratio.",
    defaultSystemPrompt:
      `You are a video director and prompt engineer.\n` +
      `Read the script provided by the user and break it into sequential scenes.\n\n` +
      `Return ONLY a JSON array (no prose, no code fences) where each element is:\n` +
      `{\n` +
      `  "scene": <number starting at 1>,\n` +
      `  "time": "<start-end, e.g. 0:00-0:05>",\n` +
      `  "narration": "<the exact words spoken during this scene>",\n` +
      `  "onScreenText": "<short caption/keyword to overlay, or empty string>",\n` +
      `  "imagePrompt": "<a vivid, self-contained text-to-image prompt; describe style, subject, lighting, composition; end with 'aspect ratio {{dimensions}}'>"\n` +
      `}\n\n` +
      `Make imagePrompts consistent in art style across scenes. Aim for one scene every 4-8 seconds.`,
  },
  {
    id: "images",
    title: "Image Generation",
    kind: "image",
    short: "Render each scene",
    description:
      "Generates an image for every scene using the prompts from the Visual Director, at your chosen aspect ratio.",
  },
  {
    id: "video",
    title: "Video Generation",
    kind: "video",
    short: "Animate scenes (credits)",
    description:
      "Optional motion agent: turns scenes into short video clips (text→video, or image→video that animates each still). Every provider runs on limited trial credits, so this stage is not part of ‘Run full pipeline’ — trigger it per scene when you want motion.",
  },
  {
    id: "voiceover",
    title: "Voiceover",
    kind: "tts",
    short: "Narrate the script",
    description: "Converts the script into narration audio using your selected voice provider.",
  },
  {
    id: "assemble",
    title: "Storyboard / Assemble",
    kind: "assemble",
    short: "Preview + export",
    description:
      "Plays your scenes as a storyboard synced to the voiceover, and exports a real .mp4 (images + Edge-TTS narration + captions) when the Phase-2 render backend is running.",
  },
  {
    id: "publish",
    title: "Publish & Metadata",
    kind: "llm",
    short: "Titles, descriptions, tags",
    description:
      "Writes the upload-ready context for each platform you selected up top — title options, description, tags/hashtags, and what to do differently there — so you can paste it straight into YouTube Studio, Instagram, or TikTok.",
    defaultSystemPrompt:
      `You are a social media growth strategist optimizing a video for maximum reach.\n` +
      `Using the script and hook/outline the user provides, write upload metadata for EACH platform listed below. Tailor tone, title length, and hashtag count to that platform's norms — don't reuse the same title/description verbatim across platforms.\n\n` +
      `Platforms to cover: {{platforms}}\n\n` +
      `Return ONLY a JSON object (no prose, no code fences), keyed by platform id exactly as given (e.g. "youtube", "youtube-shorts", "instagram-reels", "tiktok"). Each value:\n` +
      `{\n` +
      `  "titles": [<3-5 title options, strongest first, each under the platform's effective limit>],\n` +
      `  "description": "<ready-to-paste description; front-load keywords/hook in the first line; include a call-to-action>",\n` +
      `  "tags": [<platform-appropriate hashtags/keywords WITHOUT the # symbol, right quantity for that platform>],\n` +
      `  "notes": "<1-2 sentences: what to do specifically on THIS platform for reach — posting angle, thumbnail idea, best-practice reminder>"\n` +
      `}\n\n` +
      `Topic: {{topic}}\nAudience type: {{audienceType}}\nAge group: {{ageGroup}}\nDuration: {{duration}}`,
  },
];

/** e.g. ["youtube", "tiktok"] -> "youtube (id: \"youtube\"), tiktok (id: \"tiktok\")" — human labels
 *  for the prompt's prose, with the exact id it must use as the JSON key right next to it. */
function platformsForPrompt(platforms: Platform[]): string {
  if (platforms.length === 0) return "(none selected — ask the user to pick at least one platform above)";
  return platforms.map((id) => `${PLATFORMS.find((p) => p.id === id)?.label ?? id} (id: "${id}")`).join(", ");
}

export function fillTemplate(template: string, inputs: ProjectInputs): string {
  return template
    .replaceAll("{{topic}}", inputs.topic || "(topic)")
    .replaceAll("{{dimensions}}", inputs.dimensions)
    .replaceAll("{{duration}}", inputs.duration || "(duration)")
    .replaceAll("{{audienceType}}", inputs.audienceType || "(audience)")
    .replaceAll("{{ageGroup}}", inputs.ageGroup || "(age group)")
    .replaceAll("{{platforms}}", platformsForPrompt(inputs.platforms || []));
}

export function dimsToPixels(dimensions: string): { width: number; height: number } {
  switch (dimensions) {
    case "9:16":
      return { width: 768, height: 1344 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "16:9":
    default:
      return { width: 1344, height: 768 };
  }
}

/** True for a real HTTP(S) URL the video providers can fetch — false for a
 *  browser-local blob: object URL or an inline data: URI, which only exist in
 *  this tab and aren't reachable by an external API (Runway, MiniMax I2V, ...). */
export function isRemoteImageUrl(url: string | undefined): boolean {
  return !!url && !url.startsWith("blob:") && !url.startsWith("data:");
}

/** Robustly pull a JSON array of scenes out of an LLM response. */
export function parseScenes(text: string): import("./types").Scene[] {
  let t = text.trim();
  // Strip code fences if present.
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Could not find a JSON array in the model output.");
  const arr = JSON.parse(t.slice(start, end + 1));
  return arr.map((s: any, i: number) => ({
    scene: Number(s.scene ?? i + 1),
    time: String(s.time ?? ""),
    narration: String(s.narration ?? ""),
    onScreenText: String(s.onScreenText ?? s.on_screen_text ?? ""),
    imagePrompt: String(s.imagePrompt ?? s.image_prompt ?? ""),
  }));
}

const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));

/** Robustly pull the { platformId: {...} } object out of the Publish & Metadata
 *  stage's response. Any key that isn't a known platform id is dropped — the
 *  model occasionally invents one, or echoes a label instead of the id. */
export function parsePublishPlan(text: string): PublishPlan {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Could not find a JSON object in the model output.");
  const obj = JSON.parse(t.slice(start, end + 1));
  const plan: PublishPlan = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!PLATFORM_IDS.has(key as Platform) || !value || typeof value !== "object") continue;
    const v = value as any;
    plan[key as Platform] = {
      titles: Array.isArray(v.titles) ? v.titles.map(String) : [],
      description: String(v.description ?? ""),
      tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
      notes: String(v.notes ?? ""),
    };
  }
  if (Object.keys(plan).length === 0) throw new Error("The model didn't return any recognized platform blocks.");
  return plan;
}
