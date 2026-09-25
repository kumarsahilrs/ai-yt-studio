"""
Reference readers for the Creative Brief.

Turns a link the creator pastes into plain text the research agent can use:
  - YouTube video   -> title, channel, views, description and transcript
  - YouTube channel -> recent uploads (via yt-dlp, falling back to the public
                       RSS feed; no API key) plus the opening lines ("hooks")
                       of its most-viewed recent videos
  - any web page    -> title, meta description and main readable text

Transcripts come from the `youtube-transcript-api` package, which reads
YouTube's public caption tracks. It is unofficial, so a video without captions
(or a change on YouTube's side) degrades to title + description rather than
failing the whole reference.
"""

from __future__ import annotations

import html
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import requests

MAX_CHARS = 20_000  # per reference; the research prompt trims further
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
TRANSCRIPT_LANGS = ["en", "en-US", "en-GB", "en-IN", "hi"]


def _clip(text: str, limit: int = MAX_CHARS) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit].rstrip() + " …[truncated]"


def _host(url: str) -> str:
    host = urlparse(url).netloc.lower()
    for prefix in ("www.", "m.", "music."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    return host


# --------------------------------------------------------------------------- #
# YouTube
# --------------------------------------------------------------------------- #
def youtube_video_id(url: str) -> str | None:
    parsed, host = urlparse(url), _host(url)
    if host == "youtu.be":
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid or None
    if host.endswith("youtube.com"):
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        m = re.match(r"^/(?:shorts|embed|live|v)/([\w-]{11})", parsed.path)
        if m:
            return m.group(1)
    return None


def is_youtube_channel(url: str) -> bool:
    return _host(url).endswith("youtube.com") and bool(
        re.match(r"^/(?:@[^/]+|channel/UC[\w-]+|c/[^/]+|user/[^/]+)", urlparse(url).path)
    )


def _transcript(video_id: str) -> str:
    """Caption text for a video, preferring English/Hindi, else any language."""
    from youtube_transcript_api import YouTubeTranscriptApi

    if hasattr(YouTubeTranscriptApi, "fetch") or hasattr(YouTubeTranscriptApi(), "fetch"):
        api = YouTubeTranscriptApi()  # >= 1.0 instance API
        try:
            fetched = api.fetch(video_id, languages=TRANSCRIPT_LANGS)
        except Exception:  # noqa: BLE001 — fall back to whatever track exists
            fetched = next(iter(api.list(video_id))).fetch()
        parts = [snippet.text for snippet in fetched]
    else:  # pragma: no cover — pre-1.0 static API
        parts = [d["text"] for d in YouTubeTranscriptApi.get_transcript(video_id, languages=TRANSCRIPT_LANGS)]

    text = html.unescape(" ".join(parts))
    text = re.sub(r"\[(?:music|applause|laughter)\]", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def _watch_page_meta(video_id: str) -> dict:
    """Description and view count scraped from the public watch page."""
    resp = requests.get(f"https://www.youtube.com/watch?v={video_id}", headers=HEADERS, timeout=20)
    page = resp.text
    meta: dict = {}
    m = re.search(r'"shortDescription":"((?:[^"\\]|\\.)*)"', page)
    if m:
        meta["description"] = json.loads(f'"{m.group(1)}"')
    m = re.search(r'"viewCount":"(\d+)"', page)
    if m:
        meta["views"] = int(m.group(1))
    return meta


def _oembed(url: str) -> dict:
    resp = requests.get(
        "https://www.youtube.com/oembed", params={"url": url, "format": "json"}, headers=HEADERS, timeout=15
    )
    return resp.json() if resp.ok else {}


def read_youtube_video(url: str) -> dict:
    video_id = youtube_video_id(url)
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    info = _oembed(canonical)
    if not info:
        raise ValueError("YouTube couldn't find that video (is it private or deleted?)")

    meta: dict = {}
    try:
        meta = _watch_page_meta(video_id)
    except Exception:  # noqa: BLE001 — description is a nice-to-have
        pass
    try:
        transcript, transcript_note = _transcript(video_id), ""
    except Exception as exc:  # noqa: BLE001
        transcript, transcript_note = "", f"Transcript unavailable ({type(exc).__name__})."

    views = f"{meta['views']:,} views" if meta.get("views") else ""
    lines = [f'YouTube video: "{info.get("title", "")}" by {info.get("author_name", "")} {f"({views})" if views else ""}'.strip()]
    if meta.get("description"):
        lines.append("Description:\n" + _clip(meta["description"], 1500))
    lines.append("Transcript:\n" + transcript if transcript else transcript_note)

    return {
        "kind": "youtube-video",
        "title": info.get("title", ""),
        "author": info.get("author_name", ""),
        "content": _clip("\n\n".join(lines)),
        "meta": {"videoId": video_id, "views": meta.get("views"), "hasTranscript": bool(transcript)},
    }


def _channel_id(url: str) -> str:
    m = re.search(r"/channel/(UC[\w-]{22})", url)
    if m:
        return m.group(1)
    page = requests.get(url, headers=HEADERS, timeout=20).text
    for pattern in (
        r'"externalId":"(UC[\w-]{22})"',
        r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
        r'"channelId":"(UC[\w-]{22})"',
    ):
        m = re.search(pattern, page)
        if m:
            return m.group(1)
    raise ValueError("Couldn't find that YouTube channel")


def _channel_uploads_ytdlp(url: str) -> tuple[str, str, list[dict]]:
    """Recent uploads via yt-dlp (reliable, no API key). Returns (title, id, videos)."""
    import yt_dlp

    parsed = urlparse(url)
    base = f"https://www.youtube.com{parsed.path.rstrip('/')}"
    # List the uploads tab unless the creator pointed at a specific one (e.g. /shorts).
    if not re.search(r"/(videos|shorts|streams)$", base):
        base = re.sub(r"/(featured|playlists|community|about|posts)$", "", base) + "/videos"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "playlistend": 15,
        "skip_download": True,
        "socket_timeout": 30,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(base, download=False)
    videos = [
        {
            "id": e.get("id", ""),
            "title": e.get("title", ""),
            "published": "",
            "description": e.get("description") or "",
            "views": e.get("view_count"),
            "duration": e.get("duration"),
        }
        for e in (info.get("entries") or [])
        if e and e.get("id")
    ]
    if not videos:
        raise ValueError("No public videos found on that channel")
    return info.get("channel") or info.get("uploader") or info.get("title", ""), info.get("channel_id", ""), videos


def _channel_uploads_rss(url: str) -> tuple[str, str, list[dict]]:
    """Fallback: YouTube's public RSS feed (fast, but intermittently returns 404/500)."""
    channel_id = _channel_id(url)
    feed = requests.get(
        "https://www.youtube.com/feeds/videos.xml", params={"channel_id": channel_id}, headers=HEADERS, timeout=20
    )
    feed.raise_for_status()
    ns = {
        "a": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    root = ET.fromstring(feed.content)
    videos = []
    for entry in root.findall("a:entry", ns):
        group = entry.find("media:group", ns)
        stats = group.find("media:community/media:statistics", ns) if group is not None else None
        videos.append(
            {
                "id": entry.findtext("yt:videoId", default="", namespaces=ns),
                "title": entry.findtext("a:title", default="", namespaces=ns),
                "published": entry.findtext("a:published", default="", namespaces=ns)[:10],
                "description": (group.findtext("media:description", default="", namespaces=ns) if group is not None else ""),
                "views": int(stats.get("views")) if stats is not None and stats.get("views") else None,
                "duration": None,
            }
        )
    return root.findtext("a:title", default="", namespaces=ns), channel_id, videos


def read_youtube_channel(url: str) -> dict:
    try:
        channel_title, channel_id, videos = _channel_uploads_ytdlp(url)
        source = "yt-dlp"
    except Exception as primary_exc:  # noqa: BLE001
        try:
            channel_title, channel_id, videos = _channel_uploads_rss(url)
            source = "rss"
        except Exception:  # noqa: BLE001
            raise ValueError(f"Couldn't read that channel ({primary_exc})") from primary_exc

    lines = [f"YouTube channel: {channel_title}", "Recent uploads (newest first):"]
    for i, v in enumerate(videos, 1):
        views = f" — {v['views']:,} views" if v["views"] is not None else ""
        length = f" — {v['duration'] // 60}:{v['duration'] % 60:02d}" if v.get("duration") else ""
        date = f" ({v['published']})" if v["published"] else ""
        desc = re.sub(r"\s+", " ", v["description"])[:160]
        lines.append(f"{i}. {v['title']}{views}{length}{date}{f' — {desc}' if desc else ''}")

    # How this creator opens their videos: the first ~1200 chars of the top performers.
    top = sorted((v for v in videos if v["views"] is not None), key=lambda v: v["views"], reverse=True)[:2]
    hooks = []
    for v in top:
        try:
            hooks.append(f'"{v["title"]}" opens with:\n{_transcript(v["id"])[:1200]}')
        except Exception:  # noqa: BLE001
            continue
    if hooks:
        lines += ["", "Openings (hooks) of the most-viewed recent videos:", *hooks]

    return {
        "kind": "youtube-channel",
        "title": channel_title,
        "author": channel_title,
        "content": _clip("\n".join(lines)),
        "meta": {"channelId": channel_id, "videos": len(videos), "hooks": len(hooks), "source": source},
    }


# --------------------------------------------------------------------------- #
# Web pages
# --------------------------------------------------------------------------- #
class _ReadableText(HTMLParser):
    SKIP = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "iframe", "button", "select"}
    BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "li", "blockquote", "pre", "td", "th", "tr", "article", "section", "div", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.in_title = False
        self.title = ""
        self.description = ""
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip_depth += 1
        elif tag == "title":
            self.in_title = True
        elif tag == "meta":
            a = dict(attrs)
            if (a.get("name") or a.get("property", "")).lower() in ("description", "og:description") and not self.description:
                self.description = a.get("content", "") or ""
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip_depth:
            self.skip_depth -= 1
        elif tag == "title":
            self.in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip_depth:
            self.parts.append(data)


def read_web_page(url: str) -> dict:
    resp = requests.get(url, headers=HEADERS, timeout=25)
    resp.raise_for_status()
    if "html" not in resp.headers.get("content-type", "html"):
        text = resp.text if resp.headers.get("content-type", "").startswith("text/") else ""
        if not text:
            raise ValueError(f"Unsupported content type: {resp.headers.get('content-type')}")
        return {"kind": "web", "title": url, "author": _host(url), "content": _clip(text), "meta": {}}

    parser = _ReadableText()
    parser.feed(resp.text)
    # Keep substantive lines only (drops leftover menu items, cookie links, etc.).
    lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).split("\n")]
    body = "\n".join(line for line in lines if len(line.split()) >= 6)
    title = re.sub(r"\s+", " ", parser.title).strip() or url
    content = f"Web page: {title}\n" + (f"Summary: {parser.description.strip()}\n" if parser.description else "") + "\n" + body
    if not body:
        raise ValueError("The page had no readable text (it may need JavaScript or a login)")
    return {"kind": "web", "title": title, "author": _host(url), "content": _clip(content), "meta": {}}


def read_reference(url: str) -> dict:
    url = url.strip()
    if url.startswith("@"):  # bare channel handle
        url = f"https://www.youtube.com/{url}"
    if not re.match(r"^https?://", url, re.I):
        raise ValueError("Enter a full link starting with http(s):// (or a YouTube @handle)")
    if youtube_video_id(url):
        return read_youtube_video(url)
    if is_youtube_channel(url):
        return read_youtube_channel(url)
    return read_web_page(url)
