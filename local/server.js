/**
 * Threads Digest — ЛОКАЛЬНЫЙ сервис (на ПК пользователя, в т.ч. Windows).
 *
 * Зачем: тяжёлые задачи (ffmpeg-монтаж, Piper TTS, прокси-шлюз) крутим локально,
 * чтобы НЕ тратить бюджет Cloudflare-контейнеров аккаунта (там уже жрёт другой проект).
 * Worker в Клауде дёргает этот сервис по туннелю (cloudflared/ngrok).
 *
 * Эндпоинты:
 *   GET  /health        — проверка живости
 *   GET  /fetch?url=... — прозрачный прокси (per-account прокси из заголовка X-Proxy-Url)
 *   POST /tts           — Piper TTS: { text, lang } → { audioBase64, durationSec }
 *   POST /render        — монтаж Shorts: { contentId, segments, cardKey, backgroundKey,
 *                         musicKey, audioKey?, lang, r2? } → { videoKey, previewKey, durationSec }
 *
 * R2-доступ: из тела запроса (r2) либо из local/.env (R2_*).
 * ffmpeg должен быть в PATH. Piper скачается автоматически при первом использовании.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import sharp from "sharp";

loadDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const CACHE_DIR = path.join(__dirname, ".cache"); // голоса Piper, бинарь Piper
const TMP_DIR = path.join(__dirname, ".tmp");     // временные файлы рендера

// ffmpeg/Piper на Windows не любят обратные слэши в аргументах — приводим к прямым.
const ff = (p) => p.replace(/\\/g, "/");

const VOICES = {
  ru: {
    onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/dmitry/medium/ru_RU-dmitry_medium.onnx",
    json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/dmitry/medium/ru_RU-dmitry_medium.onnx.json",
  },
  en: {
    onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac_medium.onnx",
    json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac_medium.onnx.json",
  },
};

const PIPER_RELEASES = {
  win32: "https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_windows_amd64.zip",
  linux: "https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz",
  darwin: "https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_macos_x86_64.tar.gz",
};

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(stderr) : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-2000)}`))));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}

async function ffprobeDuration(file) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ff(file)]);
  return Number(String(out).trim());
}

// ── Piper (авто-загрузка под платформу) ─────────────────────────────────────
async function ensurePiper() {
  const dir = path.join(CACHE_DIR, "piper");
  await mkdir(dir, { recursive: true });
  const url = PIPER_RELEASES[process.platform] ?? PIPER_RELEASES.linux;
  const archive = path.join(dir, process.platform === "win32" ? "piper.zip" : "piper.tgz");
  if (!existsSync(archive)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`piper download ${res.status}: ${url}`);
    await writeFile(archive, Buffer.from(await res.arrayBuffer()));
  }
  await run("tar", ["-xf", ff(archive), "-C", ff(dir)]);
}

function piperBin() {
  const name = process.platform === "win32" ? "piper.exe" : "piper";
  return ff(path.join(CACHE_DIR, "piper", name));
}

async function ensureVoice(lang) {
  const dir = path.join(CACHE_DIR, "voices", lang);
  await mkdir(dir, { recursive: true });
  const onnx = path.join(dir, `${lang}.onnx`);
  const cfg = path.join(dir, `${lang}.onnx.json`);
  if (!existsSync(onnx)) {
    for (const [url, dest] of [[VOICES[lang].onnx, onnx], [VOICES[lang].json, cfg]]) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`voice download ${res.status}: ${url}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
  return ff(onnx);
}

async function ttsSegment(text, lang, outWav) {
  if (!existsSync(piperBin())) await ensurePiper();
  const model = await ensureVoice(lang === "en" ? "en" : "ru");
  await run(piperBin(), ["--model", model, "--output_file", ff(outWav)], text);
  return ffprobeDuration(outWav);
}

// ── R2 (S3 API) ─────────────────────────────────────────────────────────────
function r2Creds(body) {
  const r2 = body.r2 ?? {
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET ?? "threads-digest-media",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  };
  if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey) {
    throw new Error("R2 credentials missing (pass in body.r2 or set R2_* in local/.env)");
  }
  return r2;
}

function s3(r2) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
}

async function r2Get(r2, key) {
  const res = await s3(r2).send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

async function r2Put(r2, key, body, contentType) {
  await s3(r2).send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }));
}

// ── Субтитры ASS (karaoke по словам) ───────────────────────────────────────
function assTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), cs = Math.floor((sec % 1) * 100);
  const p = (n) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

function buildAss(segments) {
  const events = [];
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const chunks = [];
    for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3));
    const span = seg.endSec - seg.startSec;
    chunks.forEach((chunk, i) => {
      const start = seg.startSec + (span * i) / chunks.length;
      const end = seg.startSec + (span * (i + 1)) / chunks.length;
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${chunk.join(" ")}`);
    });
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Inter,72,&H00FFFFFF,&H000019FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,700,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}

// ── POST /render ────────────────────────────────────────────────────────────
async function handleRender(body) {
  const { contentId, segments, cardKey, backgroundKey, musicKey, audioKey, lang } = body;
  if (!contentId || !Array.isArray(segments)) throw new Error("missing contentId/segments");
  const r2 = r2Creds(body);
  const dir = path.join(TMP_DIR, `render-${contentId}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const [cardSvg, background, music] = await Promise.all([
    r2Get(r2, cardKey),
    r2Get(r2, backgroundKey),
    r2Get(r2, musicKey),
  ]);
  await writeFile(path.join(dir, "card.svg"), cardSvg);
  await writeFile(path.join(dir, "bg.mp4"), background);
  await writeFile(path.join(dir, "music.mp3"), music);

  const timed = [];
  if (audioKey) {
    const audio = await r2Get(r2, audioKey);
    await writeFile(path.join(dir, "voice.wav"), audio);
    const total = await ffprobeDuration(path.join(dir, "voice.wav"));
    let cursor = 0;
    const totalLen = segments.reduce((s, x) => s + x.text.length, 0) || 1;
    for (const seg of segments) {
      const share = (total * seg.text.length) / totalLen;
      timed.push({ ...seg, startSec: cursor, endSec: cursor + share });
      cursor += share;
    }
  } else {
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const wav = path.join(dir, `seg-${i}.wav`);
      const dur = await ttsSegment(segments[i].text, lang === "en" ? "en" : "ru", wav);
      timed.push({ ...segments[i], startSec: cursor, endSec: cursor + dur });
      cursor += dur;
    }
    const concatList = segments.map((_, i) => `file '${ff(path.join(dir, `seg-${i}.wav`))}'`).join("\n");
    await writeFile(path.join(dir, "concat.txt"), concatList);
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", ff(path.join(dir, "concat.txt")), "-c", "copy", ff(path.join(dir, "voice.wav"))]);
  }
  const totalSec = timed.length ? timed[timed.length - 1].endSec : 0;
  if (totalSec < 5) throw new Error(`rendered voice too short: ${totalSec}s`);

  await sharp(path.join(dir, "card.svg")).png().resize(1080).toFile(path.join(dir, "card.png"));
  await writeFile(path.join(dir, "subs.ass"), buildAss(timed));

  const postSeg = timed.find((s) => s.type === "post") ?? timed[0];
  const cardStart = postSeg.startSec;
  const cardEnd = timed[timed.length - 1].endSec;
  const filter = [
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]",
    `[bg][1:v]overlay=(W-w)/2:180:enable='between(t,${cardStart.toFixed(2)},${cardEnd.toFixed(2)})':format=yuv420[v]`,
    "[3:a]volume=0.12[music]",
    "[music][2:a]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=500[ducked]",
    "[ducked][2:a]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1:LRA=11[a]",
  ].join(";");
  const baseArgs = [
    "-y", "-stream_loop", "-1", "-i", ff(path.join(dir, "bg.mp4")),
    "-loop", "1", "-i", ff(path.join(dir, "card.png")),
    "-i", ff(path.join(dir, "voice.wav")),
    "-stream_loop", "-1", "-i", ff(path.join(dir, "music.mp3")),
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(Math.ceil(totalSec)), ff(path.join(dir, "out.mp4")),
  ];
  try {
    await run("ffmpeg", baseArgs);
  } catch {
    const noSubs = filter.replace(/,subtitles=\S+/, "");
    await run("ffmpeg", baseArgs.map((a) => (a === filter ? noSubs : a)));
  }

  await run("ffmpeg", ["-y", "-ss", "1", "-i", ff(path.join(dir, "out.mp4")), "-frames:v", "1", ff(path.join(dir, "preview.png"))]);
  const videoKey = `shorts/${contentId}.mp4`;
  const previewKey = `shorts/${contentId}-preview.png`;
  await r2Put(r2, videoKey, await readFile(path.join(dir, "out.mp4")), "video/mp4");
  await r2Put(r2, previewKey, await readFile(path.join(dir, "preview.png")), "image/png");

  await rm(dir, { recursive: true, force: true });
  return { videoKey, previewKey, durationSec: Math.round(totalSec * 10) / 10, segments: timed };
}

// ── POST /tts ───────────────────────────────────────────────────────────────
async function handleTts(body) {
  const text = String(body.text ?? "");
  const lang = body.lang === "en" ? "en" : "ru";
  const dir = path.join(TMP_DIR, "tts");
  await mkdir(dir, { recursive: true });
  const wav = path.join(dir, `tts-${Date.now()}.wav`);
  const dur = await ttsSegment(text, lang, wav);
  const audio = await readFile(wav);
  return { audioBase64: audio.toString("base64"), durationSec: dur };
}

// ── GET/POST /fetch — прозрачный прокси (per-account прокси из X-Proxy-Url) ──
async function handleFetch(req, target, incomingHeaders) {
  const proxyUrl = incomingHeaders["x-proxy-url"];
  const forward = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    if (["x-proxy-url", "host", "content-length", "connection"].includes(k)) continue;
    forward[k] = v;
  }
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const res = await undiciFetch(target, {
    method: req.method,
    headers: forward,
    dispatcher,
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  const body = await res.text();
  return { status: res.status, body };
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "threads-digest-local", platform: process.platform });
    if (req.method === "POST" && url.pathname === "/render") return json(res, 200, await handleRender(await readJsonBody(req)));
    if (req.method === "POST" && url.pathname === "/tts") return json(res, 200, await handleTts(await readJsonBody(req)));
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/fetch") {
      const target = req.method === "POST"
        ? (await readJsonBody(req)).url
        : url.searchParams.get("url");
      if (!target) return json(res, 400, { error: "missing url" });
      const result = await handleFetch(req, target, Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])));
      res.writeHead(result.status, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(result.body);
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`threads-digest-local listening on ${PORT} (ffmpeg + Piper + proxy), platform=${process.platform}`);
  console.log(`Expose it to Cloudflare: cloudflared tunnel --url http://localhost:${PORT}`);
});
