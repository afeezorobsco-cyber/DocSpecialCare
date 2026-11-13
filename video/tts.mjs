// Generates the narration for every scene and the timing the animation follows.
//   node tts.mjs            -> ElevenLabs if ELEVENLABS_API_KEY is available, else macOS `say` (draft)
//   node tts.mjs --draft    -> force macOS `say`
// Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (optional), loaded from ../../.elevenlabs.env if present.
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";

const HERE = new URL(".", import.meta.url).pathname;
const AUDIO = HERE + "audio/";
mkdirSync(AUDIO, { recursive: true });

const envFile = HERE + "../../.elevenlabs.env";
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const EDGE = process.argv.includes("--edge"); // Microsoft neural voice, e.g. en-NG-AbeoNeural (Nigerian English, male)
const EDGE_VOICE = process.env.EDGE_VOICE || "en-NG-AbeoNeural";
const EDGE_BIN = process.env.EDGE_TTS_BIN || "edge-tts";
const KEY = process.argv.includes("--draft") || EDGE ? null : process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // "Sarah": warm, clear
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

const script = JSON.parse(readFileSync(HERE + "script.json", "utf8"));
const ff = (args) => execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const duration = (f) =>
  Number(execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

async function eleven(text, prev, next, out) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      previous_text: prev || undefined,
      next_text: next || undefined,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: 0.95 },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

const LEAD = 0.6; // silence before first line
const GAP = 0.5; // breathing room after each scene's narration
const TAIL = 2.5; // hold on the outro

const scenes = script.scenes;
const timing = [];
let t = 0;
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  const raw = AUDIO + s.id + (KEY || EDGE ? ".mp3" : ".aiff");
  const wav = AUDIO + s.id + ".wav";
  if (KEY) {
    process.stdout.write(`🎙  ${s.id} (ElevenLabs)… `);
    await eleven(s.text, scenes[i - 1]?.text, scenes[i + 1]?.text, raw);
  } else if (EDGE) {
    process.stdout.write(`🎙  ${s.id} (${EDGE_VOICE})… `);
    execFileSync(EDGE_BIN, ["--voice", EDGE_VOICE, `--rate=${process.env.EDGE_RATE || "+6%"}`, "--text", s.text, "--write-media", raw]);
  } else {
    process.stdout.write(`🎙  ${s.id} (draft voice)… `);
    execFileSync("say", ["-v", "Samantha", "-r", "175", "-o", raw, s.text]);
  }
  ff(["-i", raw, "-ar", "48000", "-ac", "2", wav]);
  const speech = duration(wav);
  const lead = i === 0 ? LEAD : 0;
  const dur = lead + speech + (i === scenes.length - 1 ? TAIL : GAP);
  // pad each scene's audio to its exact slot so the concat lines up with the visuals
  ff(["-i", wav, "-af", `adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad`, "-t", dur.toFixed(3), AUDIO + s.id + ".slot.wav"]);
  timing.push({ id: s.id, visual: s.visual, text: s.text, start: +t.toFixed(3), dur: +dur.toFixed(3), speechStart: +(t + lead).toFixed(3), speech: +speech.toFixed(3) });
  t += dur;
  console.log(`${speech.toFixed(1)}s`);
}

writeFileSync(AUDIO + "list.txt", scenes.map((s) => `file '${AUDIO}${s.id}.slot.wav'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", AUDIO + "list.txt", "-c", "pcm_s16le", AUDIO + "narration.wav"]);
writeFileSync(AUDIO + "timing.json", JSON.stringify({ total: +t.toFixed(3), voice: KEY ? `elevenlabs:${VOICE}` : EDGE ? `edge:${EDGE_VOICE}` : "draft:say", scenes: timing }, null, 2));
console.log(`\nTotal ${t.toFixed(1)}s → audio/narration.wav, audio/timing.json`);
