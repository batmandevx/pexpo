// AccessFit bridge server: serves the app AND powers the AI coach with GitHub Copilot CLI.
// Run:  node server.js   then open http://localhost:8000
import http from "http";
import https from "https";
import { readFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8000;
const YT_KEY = "AIzaSyBdbirr7DX_BpEsjjYk5yTWXgKIUP-e6W4";

// Fetch top embeddable tutorial videos from YouTube for a query.
function searchYouTube(query) {
  return new Promise((resolve) => {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
      `&maxResults=4&videoEmbeddable=true&safeSearch=strict&q=${encodeURIComponent(query)}&key=${YT_KEY}`;
    https.get(url, (r) => {
      let data = "";
      r.on("data", c => data += c);
      r.on("end", () => {
        try {
          const j = JSON.parse(data);
          const vids = (j.items || []).map(it => ({
            id: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle,
            thumb: it.snippet.thumbnails?.medium?.url
          }));
          resolve(vids);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

// Ask GitHub Copilot CLI a question, return only the agent's text answer.
function askCopilot(prompt) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "-s", "--allow-all-tools", "--no-color",
      "--model", "claude-haiku-4.5"];
    const child = spawn("copilot", args, { windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); resolve("Coach is thinking too long — try again."); }, 60000);
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", () => {
      clearTimeout(timer);
      const text = out.trim();
      resolve(text || "Sorry, I couldn't generate a tip right now. Keep up the great work!");
    });
    child.on("error", () => { clearTimeout(timer); resolve("Copilot CLI not reachable from the server."); });
  });
}

const server = http.createServer(async (req, res) => {
  // --- AI coach endpoint ---
  if (req.method === "POST" && req.url === "/api/coach") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { question, ctx } = JSON.parse(body || "{}");
        const prompt =
          `Provide a brief, encouraging, accessibility-friendly fitness coaching tip ` +
          `to help someone exercising safely at home. Keep it to at most 2 short sentences, ` +
          `plain text, no markdown, no preamble, and be safety-conscious. ` +
          `Live workout data: ${ctx}. Their question: "${question}".`;
        const answer = await askCopilot(prompt);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ answer }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ answer: "Server error: " + e.message }));
      }
    });
    return;
  }

  // --- YouTube tutorial videos endpoint ---
  if (req.method === "GET" && req.url.startsWith("/api/videos")) {
    const q = new URL(req.url, "http://localhost").searchParams.get("q") || "exercise tutorial";
    const vids = await searchYouTube(q);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ videos: vids }));
    return;
  }

  // --- static file serving ---
  let file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const data = await readFile(path.join(__dirname, file));
    const ext = path.extname(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

server.listen(PORT, () => console.log(`AccessFit running → http://localhost:${PORT}`));
