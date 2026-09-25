"""
AI YT Studio — Phase 2 render backend.

A tiny local FastAPI service that adds the two things a browser can't do:
  1. /render/tts    — realistic, free Edge-TTS narration (returns an mp3)
  2. /render/video  — stitches scenes into a real .mp4 (via MoviePy/ffmpeg): each
                      scene uses its generated video clip if present, else its
                      still with Ken-Burns zoom, timed to per-scene Edge-TTS
                      narration, with a fixed caption overlay

The Vite dev server proxies /render/* here (see vite.config.ts), so the frontend
calls it same-origin with no CORS setup needed.

Run:
    cd backend
    python -m venv .venv && .venv\\Scripts\\activate      (Windows)
    pip install -r requirements.txt
    uvicorn main:app --port 8000 --reload
"""

import asyncio
import base64
import io
import os
import shutil
import tempfile
import textwrap

import edge_tts
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel
from starlette.background import BackgroundTask

from references import read_reference

app = FastAPI(title="AI YT Studio render backend")

# The frontend reaches us via the Vite proxy (same-origin), but allow direct
# access from the dev origins too for convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_VOICE = "en-US-AriaNeural"


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class ReferenceIn(BaseModel):
    url: str


class TtsIn(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE
    rate: str | None = None  # e.g. "+10%"


class SceneIn(BaseModel):
    scene: int
    narration: str = ""
    onScreenText: str = ""
    image: str | None = None  # remote URL or data: URI
    video: str | None = None  # remote clip URL or data: URI — used instead of the still when present


class VideoJob(BaseModel):
    dimensions: str = "16:9"
    voice: str = DEFAULT_VOICE
    rate: str | None = None  # Edge-TTS speaking rate, e.g. "+10%"
    fps: int = 24
    kenburns: bool = True  # slow zoom on still scenes
    captions: bool = True  # burn on-screen text over each scene
    scenes: list[SceneIn]


# --------------------------------------------------------------------------- #
# Edge-TTS helpers
# --------------------------------------------------------------------------- #
async def synth_to_file(text: str, voice: str, path: str, rate: str | None = None) -> None:
    kwargs = {}
    if rate:
        kwargs["rate"] = rate
    communicate = edge_tts.Communicate(text, voice or DEFAULT_VOICE, **kwargs)
    await communicate.save(path)


# --------------------------------------------------------------------------- #
# Image / frame building
# --------------------------------------------------------------------------- #
def _dims(ratio: str) -> tuple[int, int]:
    if ratio == "9:16":
        return 720, 1280
    if ratio == "1:1":
        return 1080, 1080
    return 1280, 720


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\ariblk.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        "DejaVuSans-Bold.ttf",
        "arialbd.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _fetch_image(spec: str) -> Image.Image:
    if spec.startswith("data:"):
        _, b64 = spec.split(",", 1)
        data = base64.b64decode(b64)
    else:
        resp = requests.get(spec, timeout=180)
        resp.raise_for_status()
        data = resp.content
    return Image.open(io.BytesIO(data)).convert("RGB")


def _cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Resize + center-crop to fill w×h (object-fit: cover)."""
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    nw, nh = max(w, int(sw * scale)), max(h, int(sh * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - w) // 2, (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


def _draw_caption(img: Image.Image, text: str, w: int, h: int) -> None:
    if not text.strip():
        return
    draw = ImageDraw.Draw(img, "RGBA")
    font = _load_font(max(24, int(h * 0.055)))
    wrapped = textwrap.fill(text.strip(), width=28)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, align="center", spacing=6)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (w - tw) // 2
    y = int(h * 0.80) - th // 2
    pad = int(h * 0.02)
    draw.rounded_rectangle(
        [x - pad, y - pad, x + tw + pad, y + th + pad],
        radius=pad,
        fill=(0, 0, 0, 140),
    )
    # simple stroke for legibility
    draw.multiline_text(
        (x, y), wrapped, font=font, fill=(255, 255, 255, 255),
        align="center", spacing=6, stroke_width=2, stroke_fill=(0, 0, 0, 255),
    )


def _still_image(scene: SceneIn, w: int, h: int) -> np.ndarray:
    if scene.image:
        try:
            return np.array(_cover(_fetch_image(scene.image), w, h))
        except Exception:
            pass
    return np.array(Image.new("RGB", (w, h), (12, 14, 20)))


def _caption_overlay(text: str, w: int, h: int) -> np.ndarray | None:
    """Transparent RGBA layer holding only the caption, so it stays fixed while
    the image underneath zooms or a clip plays."""
    if not text.strip():
        return None
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    _draw_caption(canvas, text, w, h)
    return np.array(canvas)


def _download_to_file(spec: str, workdir: str, name: str) -> str:
    if spec.startswith("data:"):
        _, b64 = spec.split(",", 1)
        data = base64.b64decode(b64)
    else:
        resp = requests.get(spec, timeout=300)
        resp.raise_for_status()
        data = resp.content
    path = os.path.join(workdir, name)
    with open(path, "wb") as f:
        f.write(data)
    return path


# --------------------------------------------------------------------------- #
# Video assembly (runs in a worker thread — MoviePy/ffmpeg is blocking)
#
# Each scene is a composite of two layers:
#   base    — the scene's generated video clip (cover-fit, trimmed or looped to
#             the narration length), or its still image with Ken-Burns zoom
#   caption — a static transparent overlay, so text never zooms or drifts
# --------------------------------------------------------------------------- #
def _still_layer(scene: SceneIn, w: int, h: int, duration: float, index: int, kenburns: bool):
    from moviepy import ImageClip

    clip = ImageClip(_still_image(scene, w, h)).with_duration(duration)
    if kenburns:
        zmax = 1.12
        d = max(duration, 0.01)
        # Alternate zoom-in / zoom-out between scenes for variety. Scale never
        # drops below 1, so the image always covers the frame.
        if index % 2 == 0:
            clip = clip.resized(lambda t: 1 + (zmax - 1) * min(1.0, t / d))
        else:
            clip = clip.resized(lambda t: zmax - (zmax - 1) * min(1.0, t / d))
    return clip.with_position("center")


def _video_layer(scene: SceneIn, w: int, h: int, duration: float, workdir: str):
    from moviepy import VideoFileClip, vfx

    path = _download_to_file(scene.video, workdir, f"clip_{scene.scene}.mp4")
    clip = VideoFileClip(path).without_audio()  # narration replaces clip audio
    sw, sh = clip.size
    scale = max(w / sw, h / sh)  # cover-fit; the composite frame crops overflow
    clip = clip.resized((max(w, round(sw * scale)), max(h, round(sh * scale))))
    if clip.duration >= duration:
        clip = clip.subclipped(0, duration)
    else:
        clip = clip.with_effects([vfx.Loop(duration=duration)])
    return clip.with_position("center")


def build_movie(
    prepared: list[tuple[SceneIn, str | None]],
    dimensions: str,
    fps: int,
    workdir: str,
    kenburns: bool = True,
    captions: bool = True,
) -> str:
    from moviepy import AudioFileClip, CompositeVideoClip, ImageClip, concatenate_videoclips

    w, h = _dims(dimensions)
    clips = []
    for index, (scene, audio_path) in enumerate(prepared):
        duration = 3.0
        audio = None
        if audio_path and os.path.exists(audio_path):
            audio = AudioFileClip(audio_path)
            duration = max(1.0, audio.duration) + 0.35

        base = None
        if scene.video:
            try:
                base = _video_layer(scene, w, h, duration, workdir)
            except Exception as exc:  # noqa: BLE001
                print(f"[render] scene {scene.scene}: clip unusable ({exc}); using still")
        if base is None:
            base = _still_layer(scene, w, h, duration, index, kenburns)

        layers = [base]
        overlay = _caption_overlay(scene.onScreenText, w, h) if captions else None
        if overlay is not None:
            layers.append(ImageClip(overlay, transparent=True).with_duration(duration))

        clip = CompositeVideoClip(layers, size=(w, h)).with_duration(duration)
        if audio is not None:
            clip = clip.with_audio(audio)
        clips.append(clip)

    if not clips:
        raise HTTPException(status_code=400, detail="No scenes to render.")

    final = concatenate_videoclips(clips, method="compose")
    out_path = os.path.join(workdir, "ai-yt-studio.mp4")
    try:
        final.write_videofile(
            out_path,
            fps=fps,
            codec="libx264",
            audio_codec="aac",
            logger=None,
            threads=4,
        )
    finally:
        # Release ffmpeg readers so the temp dir can be removed (Windows locks open files).
        for c in [final, *clips]:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
    return out_path


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/render/health")
def health():
    return {"ok": True, "service": "ai-yt-studio-render", "voice_default": DEFAULT_VOICE}


@app.get("/render/voices")
async def voices(lang: str = "en"):
    """List Edge-TTS voices (optionally filtered by language prefix)."""
    all_voices = await edge_tts.list_voices()
    items = [
        {"name": v["ShortName"], "gender": v.get("Gender"), "locale": v.get("Locale")}
        for v in all_voices
        if not lang or v.get("Locale", "").lower().startswith(lang.lower())
    ]
    items.sort(key=lambda x: x["name"])
    return {"voices": items}


@app.post("/render/reference")
def reference(body: ReferenceIn):
    """Read a YouTube video/channel or web page into text for the research agent."""
    try:
        return read_reference(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — network errors, blocked pages, etc.
        raise HTTPException(status_code=502, detail=f"Couldn't read that link: {exc}")


@app.post("/render/tts")
async def tts(body: TtsIn):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.close()
    try:
        await synth_to_file(body.text, body.voice, tmp.name, body.rate)
        with open(tmp.name, "rb") as f:
            data = f.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    return Response(content=data, media_type="audio/mpeg")


@app.post("/render/video")
async def render_video(job: VideoJob):
    if not job.scenes:
        raise HTTPException(status_code=400, detail="scenes are required")

    workdir = tempfile.mkdtemp(prefix="aiyt_")
    prepared: list[tuple[SceneIn, str | None]] = []

    # 1) Synthesize per-scene narration (sequential; Edge-TTS needs internet).
    for scene in job.scenes:
        audio_path = None
        if scene.narration.strip():
            audio_path = os.path.join(workdir, f"scene_{scene.scene}.mp3")
            try:
                await synth_to_file(scene.narration, job.voice, audio_path, job.rate)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    status_code=502,
                    detail=f"Edge-TTS failed for scene {scene.scene}: {exc}. "
                    "Edge-TTS needs an internet connection.",
                )
        prepared.append((scene, audio_path))

    # 2) Assemble the mp4 in a worker thread.
    try:
        out_path = await asyncio.to_thread(
            build_movie, prepared, job.dimensions, job.fps, workdir, job.kenburns, job.captions
        )
    except HTTPException:
        shutil.rmtree(workdir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Render failed: {exc}")

    # Remove the temp dir (narration, downloaded clips, output) once the file is sent.
    return FileResponse(
        out_path,
        media_type="video/mp4",
        filename="ai-yt-studio.mp4",
        background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
    )
