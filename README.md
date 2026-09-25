# AI YT Studio

A **stagewise agentic pipeline** for producing YouTube videos, where **every stage has a swappable menu of API providers ordered free → paid**. Runs entirely in your browser (Phase 1); a Python render backend plugs in later (Phase 2).

```
Research & Hook → Scriptwriter → Visual Director → Image Generation → Video Generation → Voiceover → Storyboard/Assemble
   (LLM)            (LLM)          (LLM → scenes)     (image API)        (video, optional)   (TTS)        (preview + export)
```

> The **Video Generation** stage is an optional motion agent. Every text/image→video provider runs on limited trial credits, so it is deliberately **excluded from "Run full pipeline"** — you trigger it per scene when you actually want motion. The storyboard automatically plays clips for any scene that has one, falling back to the still otherwise.

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

- **Settings › API keys** is the vault: add each provider's key once, it's reused everywhere. Cards are grouped by kind (Text / Image / Voice) and ordered **Free → Freemium → Paid** with tier badges and "Get key" links.
- **Each stage panel** has a **Provider** dropdown (same free→paid ordering), a **model/voice** picker, and — for the writing stages — an **editable system prompt** with `{{topic}}`, `{{duration}}`, `{{audienceType}}`, `{{ageGroup}}`, `{{dimensions}}` variables.
- **API keys:** click **Save keys** in Settings to write them to `%USERPROFILE%\.ai-yt-studio\keys.json`. That's your user folder, deliberately *not* this OneDrive-synced project, so keys aren't uploaded to the cloud. They load back automatically on startup, so they survive refreshes, app restarts, and browser-storage wipes. Unsaved edits are flagged in amber, and the browser warns before you leave with unsaved keys. The file is served only to the app itself (local host and same origin only). Keys never leave your machine except to call the provider, through the local dev proxy (no CORS pain).
- Inputs, wiring, and text outputs are kept in browser `localStorage`.

### Providers included

| Stage kind | Free | Freemium | Paid |
|---|---|---|---|
| **Text / LLM** | Google Gemini, Groq | OpenRouter, Together AI | DeepSeek, OpenAI, Anthropic |
| **Images** | Pollinations (no key) | Hugging Face (FLUX), Together (FLUX) | Stability AI, OpenAI |
| **Video** | — | fal.ai, Replicate, Hugging Face, MiniMax (Hailuo) | Luma Dream Machine, Runway Gen-4, Google Veo |
| **Voice / TTS** | Browser Web Speech, Edge-TTS* | ElevenLabs | OpenAI TTS |

\* Edge-TTS needs the Phase-2 backend. All **Video** providers are credit-based (no reliable no-key option exists); the free/freemium ones give trial credits on signup.

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
  providers/     # the provider registry (llm / image / tts) — the free→paid menus
  stages.ts      # the 6 pipeline stages + default editable prompts
  engine.ts      # runs a stage / chains the whole pipeline
  store.ts       # state + localStorage persistence
  components/    # Sidebar, InputsBar, StagePanel, Settings, AssemblePlayer
vite.config.ts   # dev proxies (kills CORS) + /render slot for the Phase-2 backend
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
