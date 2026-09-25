# AI YT Studio

A **stagewise agentic pipeline** for producing YouTube videos, where **every stage has a swappable menu of API providers ordered free → paid**, and **every stage automatically falls back to the next configured provider** if the wired one fails. Runs entirely in your browser (Phase 1); a Python render backend plugs in later (Phase 2).

```
Research & Hook → Scriptwriter → Visual Director → Image Generation → Video Generation → Voiceover → Storyboard/Assemble → Publish & Metadata
   (LLM)            (LLM)          (LLM → scenes)     (image API)        (video, optional)   (TTS)        (preview + export)     (LLM → per platform)
```

> The **Video Generation** stage is an optional motion agent. Every text/image→video provider runs on limited trial credits (tracked in Settings), so it is deliberately **excluded from "Run full pipeline"** — you trigger it per scene when you actually want motion. The storyboard automatically plays clips for any scene that has one, falling back to the still otherwise.

Everything you generate — including images/audio/video — autosaves continuously (IndexedDB) and survives a refresh. A stage that's out of date relative to its own wiring or an earlier stage (you edited a prompt, reran Research, ...) is flagged so you never mistake stale output for fresh. The **Projects** panel lets you save named snapshots and switch between multiple videos; the **Content Calendar** turns a pasted channel-idea brief into a categorized Topic Library and an auto-planned posting schedule, with a one-click handoff from any calendar slot straight into the pipeline.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Cheapest possible run (one free key)

1. Get a free **Google Gemini** key → https://aistudio.google.com/app/apikey
2. **Settings & API keys** → paste it into the Gemini card.
3. Leave the defaults: **Gemini** (text) · **Pollinations** (images, no key) · **Browser Web Speech** (voice, no key).
4. Type a **Topic** up top, then click **Run full pipeline**.

That produces hooks + outline, a full script, a scene-by-scene breakdown, an image per scene, and a narrated storyboard preview — for free.

## How the "many APIs per stage" system works

- **Settings › API keys** is the vault: add each provider's key once, it's reused everywhere. Cards are grouped by kind (Text / Image / Video / Voice) and ordered **Free → Freemium → Paid** with tier badges and "Get key" links. Video provider cards also track **trial credits**: enter what a provider gave you at signup and the app counts down as you use it, disabling it in the Video stage before a call that would just fail on an empty account.
- **Each stage panel** has a **Provider** dropdown (same free→paid ordering), a **model/voice** picker, and — for the writing stages — an **editable system prompt** with `{{topic}}`, `{{duration}}`, `{{audienceType}}`, `{{ageGroup}}`, `{{dimensions}}`, `{{platforms}}` variables. If the wired provider fails (quota, rate limit, missing key, backend down), the stage automatically retries the next *configured* provider of that kind — a notice shows if/when that happened.
- **Publish target(s)**, next to Topic up top, is a multi-select (YouTube, YouTube Shorts, Instagram Reels, TikTok) that drives the **Publish & Metadata** stage: one generated block per platform — title options, description, tags/hashtags, and a platform-specific reach note — each with a one-click copy button, ready to paste into that platform's upload flow.
- **API keys:** click **Save keys** in Settings to write them to `%USERPROFILE%\.ai-yt-studio\keys.json`. That's your user folder, deliberately *not* this OneDrive-synced project, so keys aren't uploaded to the cloud. They load back automatically on startup, so they survive refreshes, app restarts, and browser-storage wipes. Unsaved edits are flagged in amber, and the browser warns before you leave with unsaved keys. The file is served only to the app itself (local host and same origin only). Keys never leave your machine except to call the provider, through the local dev proxy (no CORS pain).
- Everything else — inputs, wiring, and every stage's output (including generated images/audio/video, as `data:` URLs) — autosaves continuously to **IndexedDB**, so it survives a refresh. A lightweight text/scenes-only copy also lives in `localStorage` as a fast first-paint fallback.
- **Projects** (sidebar) lets you save the current work as a named snapshot and load it back later, so you can keep more than one video in flight.
- A stage's status dot turns **amber** once its output no longer matches its own wiring or an upstream stage's current content — a real per-stage dependency check, not a blanket "everything downstream is stale" flag — with a **Rerun** button and (on Storyboard/Assemble) an aggregate summary of what's out of date.
- The **Research & Hook** stage has a **Creative Brief** panel: paste competitor YouTube video/channel/article links and it reads each into text (transcript, views, recent uploads, or page content — via the Phase-2 backend) and hands it to the agent as grounding context, not just a summary.

### Providers included

| Stage kind | Free | Freemium | Paid |
|---|---|---|---|
| **Text / LLM** | Google Gemini, Groq | OpenRouter, Together AI | DeepSeek, OpenAI, Anthropic |
| **Images** | Pollinations (no key) | Hugging Face (FLUX), Together (FLUX) | Stability AI, OpenAI |
| **Video** | — | fal.ai, Replicate, Hugging Face, MiniMax (Hailuo) | Luma Dream Machine, Runway Gen-4, Google Veo |
| **Voice / TTS** | Browser Web Speech, Edge-TTS* | ElevenLabs | OpenAI TTS |

\* Edge-TTS needs the Phase-2 backend. All **Video** providers are credit-based (no reliable no-key option exists); the free/freemium ones give trial credits on signup.

## Content Calendar

A separate sidebar section for planning what to make, not just making it:

1. **Channel Brief** — paste or upload a `.txt`/`.md` dump of your channel idea, the categories you want to cover, and any specific topics you already have. **Analyze & build library** turns it into a categorized **Topic Library** — it fills gaps with its own expertise in the niche rather than just echoing the brief back.
2. **Library** — topics grouped by category, searchable, each schedulable to any date by hand, or added directly. **Auto-plan a calendar from these topics** proposes a full posting schedule (you set videos/week and how many weeks to plan) — spread across the week, categories varied rather than clustered, with a one-sentence reason for each placement.
3. **Calendar** — a real month grid. Click any slot to see its category/rationale, reschedule it, mark it done, or hit **Start this video** to jump straight into the pipeline with that topic pre-filled.

Both the brief analysis and the auto-scheduler reuse whatever provider is wired to the **Research & Hook** stage (with the same automatic fallback) — no separate setup needed.

## Adding a new provider (extensibility)

Add one object to the matching array in `src/providers/llm.ts`, `image.ts`, or `tts.ts`:

```ts
{
  id: "my-provider",
  name: "My Provider",
  kind: "llm",            // "llm" | "image" | "video" | "tts"
  tier: "free",           // sorts it in the free→paid dropdown
  signupUrl: "https://…", // "Get key" link
  secrets: [{ key: "apiKey", label: "API Key", type: "password" }],
  params:  [{ key: "model", label: "Model", type: "text", default: "…" }],
  async runLlm(system, user, ctx) { /* fetch via a /api/... proxy */ },
  // or runImage(prompt, ctx) / runVideo(prompt, imageUrl, ctx) / runTts(text, ctx)
}
```

If it needs a new host, add a proxy line in `vite.config.ts`. That's it — it shows up in Settings and every relevant stage automatically.

## Project layout

```
src/
  providers/       # the provider registry (llm / image / video / tts) — the free→paid menus
  stages.ts        # the 8 pipeline stages + default editable prompts
  engine.ts        # runs a stage / chains the whole pipeline; provider fallback lives here too
  planner.ts       # Content Calendar: brief -> library, library -> calendar (reuses the fallback engine)
  store.ts         # app state + localStorage (small state) + autosave gating for IndexedDB
  db.ts            # IndexedDB: projects, and the Content Calendar's topics/briefs/slots
  blob.ts          # generated files -> data: URLs, so they're plain persistable strings
  components/      # Sidebar, InputsBar, StagePanel, Settings, Projects, AssemblePlayer
  components/calendar/  # ContentCalendar container + BriefTab / LibraryTab / CalendarTab
vite.config.ts     # dev proxies (kills CORS) + /render slot for the Phase-2 backend
```

## Phase 2 — the render backend (built)

A local **FastAPI** service (in [`backend/`](backend/)) exposed under `/render` that adds what the browser can't:
- **Edge-TTS** narration — free, realistic Microsoft voices, downloadable audio (`/render/tts`, `/render/voices`)
- **MoviePy / ffmpeg** stitching into a real **.mp4** (`/render/video`). Each scene is timed to its narration and built from two layers:
  - **Base:** the scene's **video clip** from the Video Generation stage when there is one (cover-fit to the frame, trimmed or looped to the narration length). Otherwise the **still image**, with an optional slow **Ken Burns** zoom that alternates in and out between scenes.
  - **Caption:** a fixed transparent overlay, so on-screen text never zooms or drifts with the picture.

### Run the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Then in the app, the **Voiceover** stage can use the **Edge-TTS** provider for downloadable audio. The **Storyboard / Assemble** stage has an **Export real .mp4** panel: choose a voice, toggle **Ken Burns motion on stills**, and click **Render .mp4**. The panel shows how many scenes will use a clip and how many will use a still. The frontend reaches the backend through the Vite proxy (`/render`), so no CORS setup is needed. Edge-TTS needs an internet connection at render time.

> Image→video providers that animate a still (Runway, MiniMax I2V, and fal/Luma in image mode) need a **public** image URL, so generate stills with **Pollinations** if you plan to animate them. Local blob images from Hugging Face/Together won't work for this.
