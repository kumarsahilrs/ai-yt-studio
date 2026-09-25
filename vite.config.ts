import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// API keys are saved to a file in the user's home folder (not the project, which
// lives in a OneDrive-synced Desktop), so they survive browser-storage wipes,
// app restarts, and switching browsers.
const KEYS_FILE = path.join(os.homedir(), ".ai-yt-studio", "keys.json");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** GET/POST /__studio/keys — read or save API keys on disk (dev server only). */
function keysFilePlugin(): Plugin {
  return {
    name: "ai-yt-studio-keys-file",
    configureServer(server) {
      // Registered before Vite's CORS middleware, so this route sends no CORS
      // headers: other websites can't read the keys even if they call it.
      server.middlewares.use("/__studio/keys", (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };

        // Only answer the app itself: a local Host (blocks DNS rebinding) and,
        // when the browser sends one, a same-origin Origin.
        const host = req.headers.host ?? "";
        if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ""))) return send(403, { error: "Forbidden host" });
        const origin = req.headers.origin;
        if (origin) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(origin).host === host;
          } catch {
            /* "null" or malformed origin */
          }
          if (!sameOrigin) return send(403, { error: "Forbidden origin" });
        }

        if (req.method === "GET") {
          let secrets = {};
          try {
            secrets = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")).secrets ?? {};
          } catch {
            /* no file yet */
          }
          return send(200, { secrets, path: KEYS_FILE });
        }

        if (req.method === "POST") {
          // Requiring JSON forces a CORS preflight for cross-site requests, which
          // this route never approves — so other sites can't overwrite keys.
          if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
            return send(415, { error: "Expected application/json" });
          }
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1_000_000) req.destroy();
          });
          req.on("end", () => {
            try {
              const { secrets } = JSON.parse(body);
              if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
                throw new Error("Body must be { secrets: { providerId: { field: value } } }");
              }
              fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
              const tmp = `${KEYS_FILE}.tmp`;
              fs.writeFileSync(tmp, JSON.stringify({ secrets, savedAt: new Date().toISOString() }, null, 2), {
                mode: 0o600,
              });
              fs.renameSync(tmp, KEYS_FILE); // atomic replace: never a half-written file
              send(200, { ok: true, path: KEYS_FILE });
            } catch (err) {
              send(400, { error: (err as Error).message });
            }
          });
          return;
        }

        send(405, { error: "Method not allowed" });
      });
    },
  };
}

// All third-party API calls are routed through these dev-server proxies so the
// browser never makes cross-origin requests directly. This eliminates CORS
// problems for providers (Groq, OpenAI, etc.) that don't send CORS headers, and
// keeps the app "browser-only" for Phase 1 — no separate proxy server to run.
//
// The Phase-2 render backend (Edge-TTS + MoviePy) will be proxied under /render.
function proxyTarget(target: string) {
  return {
    target,
    changeOrigin: true,
    secure: true,
    // Strip the /api/<name> prefix before forwarding upstream.
    rewrite: (path: string) => path.replace(/^\/api\/[^/]+/, ""),
  };
}

export default defineConfig({
  plugins: [react(), keysFilePlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api/gemini": proxyTarget("https://generativelanguage.googleapis.com"),
      "/api/groq": proxyTarget("https://api.groq.com"),
      "/api/openrouter": proxyTarget("https://openrouter.ai"),
      "/api/openai": proxyTarget("https://api.openai.com"),
      "/api/deepseek": proxyTarget("https://api.deepseek.com"),
      "/api/together": proxyTarget("https://api.together.xyz"),
      "/api/anthropic": proxyTarget("https://api.anthropic.com"),
      "/api/hf": proxyTarget("https://api-inference.huggingface.co"),
      "/api/pollinations": proxyTarget("https://image.pollinations.ai"),
      "/api/elevenlabs": proxyTarget("https://api.elevenlabs.io"),
      "/api/stability": proxyTarget("https://api.stability.ai"),
      "/api/gtts": proxyTarget("https://texttospeech.googleapis.com"),
      // Video-generation providers (all credit-based).
      "/api/fal": proxyTarget("https://fal.run"),
      "/api/replicate": proxyTarget("https://api.replicate.com"),
      "/api/luma": proxyTarget("https://api.lumalabs.ai"),
      "/api/runway": proxyTarget("https://api.dev.runwayml.com"),
      "/api/minimax": proxyTarget("https://api.minimaxi.chat"),
      // Phase-2 backend (FastAPI). Harmless if the backend isn't running yet.
      "/render": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
