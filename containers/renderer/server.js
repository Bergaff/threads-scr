/**
 * Threads Digest — контейнер (Cloudflare Containers).
 * Один образ, две роли:
 *   RENDERER (standard-2): POST /render — монтаж Shorts (ffmpeg), POST /tts — Piper TTS
 *   PROXY    (basic):      POST /fetch  — fetch через per-account прокси для сборщика
 *
 * Контейнер stateless: всё состояние — в R2 (доступ по S3-ключам из запроса),
 * диск эфемерный. Масштаб в ноль после sleepAfter (см. src/containers.ts).
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import sharp from "sharp";

const PORT = Number(process.env.PORT ?? 8080);
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

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
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
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(String(out).trim());
}

// ── R2 (S3 API) ─────────────────────────────────────────────────────────────
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

// ── Piper TTS ───────────────────────────────────────────────────────────────
async function ensureVoice(lang) {
  const dir = "/tmp/voices";
  await mkdir(dir, { recursive: true });
  const onnx = `${dir}/${lang}.onnx`;
  const cfg = `${dir}/${lang}.onnx.json`;
  if (!existsSync(onnx)) {
    for (const [url, dest] of [[VOICES[lang].onnx, onnx], [VOICES[lang].json, cfg]]) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`voice download ${res.status}: ${url}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
  return onnx;
}

async function ttsSegment(text, lang, outWav) {
  const model = await ensureVoice(lang);
  await run("piper", ["--model", model, "--output_file", outWav], text);
  return ffprobeDuration(outWav);
}

// ── Субтитры ASS (та же логика, что в Worker: src/shorts/subtitles.ts) ──────
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
  const { contentId, segments, cardKey, backgroundKey, musicKey, audioKey, lang, r2 } = body;
  if (!contentId || !Array.isArray(segments) || !r2) throw new Error("missing contentId/segments/r2");
  const dir = `/tmp/render-${contentId}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // 1. Ассеты из R2
  const [cardSvg, background, music] = await Promise.all([
    r2Get(r2, cardKey),
    r2Get(r2, backgroundKey),
    r2Get(r2, musicKey),
  ]);
  await writeFile(`${dir}/card.svg`, cardSvg);
  await writeFile(`${dir}/bg.mp4`, background);
  await writeFile(`${dir}/music.mp3`, music);

  // 2. Озвучка: готовая (audioKey) или Piper по сегментам (реальные длительности)
  const timed = [];
  if (audioKey) {
    const audio = await r2Get(r2, audioKey);
    await writeFile(`${dir}/voice.wav`, audio);
    const total = await ffprobeDuration(`${dir}/voice.wav`);
    let cursor = 0;
    for (const seg of segments) {
      const share = total * (seg.text.length / Math.max(1, segments.reduce((s, x) => s + x.text.length, 0)));
      timed.push({ ...seg, startSec: cursor, endSec: cursor + share });
      cursor += share;
    }
  } else {
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const wav = `${dir}/seg-${i}.wav`;
      const dur = await ttsSegment(segments[i].text, lang === "en" ? "en" : "ru", wav);
      timed.push({ ...segments[i], startSec: cursor, endSec: cursor + dur });
      cursor += dur;
    }
    // Склейка сегментов в один голосовой трек
    const concatList = segments.map((_, i) => `file 'seg-${i}.wav'`).join("\n");
    await writeFile(`${dir}/concat.txt`, concatList);
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", `${dir}/concat.txt`, "-c", "copy", `${dir}/voice.wav`]);
  }
  const totalSec = timed.length ? timed[timed.length - 1].endSec : 0;
  if (totalSec < 5) throw new Error(`rendered voice too short: ${totalSec}s`);

  // 3. Карточка SVG → PNG 1080 по ширине
  await sharp(`${dir}/card.svg`).png().resize(1080).toFile(`${dir}/card.png`);

  // 4. Субтитры по реальным таймингам
  await writeFile(`${dir}/subs.ass`, buildAss(timed));

  // 5. ffmpeg: фон + карточка + субтитры + голос + музыка (ducking) + loudnorm −14 LUFS
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
    "-y", "-stream_loop", "-1", "-i", `${dir}/bg.mp4`,
    "-loop", "1", "-i", `${dir}/card.png`,
    "-i", `${dir}/voice.wav`,
    "-stream_loop", "-1", "-i", `${dir}/music.mp3`,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(Math.ceil(totalSec)), `${dir}/out.mp4`,
  ];
  try {
    await run("ffmpeg", baseArgs);
  } catch {
    // Fallback без субтитров (если в ffmpeg нет libass): тот же фильтр минус subtitles.
    const noSubs = filter.replace(",subtitles=subs.ass", "");
    await run("ffmpeg", baseArgs.map((a) => (a === filter ? noSubs : a)));
  }

  // 6. Превью-кадр + загрузка в R2
  await run("ffmpeg", ["-y", "-ss", "1", "-i", `${dir}/out.mp4`, "-frames:v", "1", `${dir}/preview.png`]);
  const videoKey = `shorts/${contentId}.mp4`;
  const previewKey = `shorts/${contentId}-preview.png`;
  await r2Put(r2, videoKey, await readFile(`${dir}/out.mp4`), "video/mp4");
  await r2Put(r2, previewKey, await readFile(`${dir}/preview.png`), "image/png");

  await rm(dir, { recursive: true, force: true });
  return { videoKey, previewKey, durationSec: Math.round(totalSec * 10) / 10, segments: timed };
}

// ── POST /fetch (прокси-шлюз) ───────────────────────────────────────────────
async function handleFetch(body) {
  const { url, headers = {}, proxyUrl, timeoutMs = 20000 } = body;
  if (!url) throw new Error("missing url");
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const res = await undiciFetch(url, {
    headers,
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "threads-digest-container" });
    if (req.method === "POST" && req.url === "/fetch") return json(res, 200, await handleFetch(await readJsonBody(req)));
    if (req.method === "POST" && req.url === "/render") return json(res, 200, await handleRender(await readJsonBody(req)));
    if (req.method === "POST" && req.url === "/tts") {
      const { text, lang } = await readJsonBody(req);
      const dir = "/tmp/tts";
      await mkdir(dir, { recursive: true });
      const wav = `${dir}/tts-${Date.now()}.wav`;
      const dur = await ttsSegment(String(text ?? ""), lang === "en" ? "en" : "ru", wav);
      const audio = await readFile(wav);
      return json(res, 200, { audioBase64: audio.toString("base64"), durationSec: dur });
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => console.log(`threads-digest-container listening on ${PORT}`));
