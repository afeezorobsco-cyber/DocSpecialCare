// Renders comp/index.html frame-by-frame with headless Chrome and encodes MP4 with the narration.
//   node render.mjs                 -> out/docspecialcare.mp4
//   node render.mjs --stills 3,20,45 -> out/still-<t>.png for quick review
import { chromium } from "playwright-core";
import { spawn } from "child_process";
import { mkdirSync, readFileSync } from "fs";
import ffmpegPath from "ffmpeg-static";

const HERE = new URL(".", import.meta.url).pathname;
const OUT = HERE + "out/";
mkdirSync(OUT, { recursive: true });
const FPS = 30;
const DATA = {
  timing: JSON.parse(readFileSync(HERE + "audio/timing.json", "utf8")),
  meta: JSON.parse(readFileSync(HERE + "shots/meta.json", "utf8")),
  txns: JSON.parse(readFileSync(HERE + "shots/txns.json", "utf8")),
};

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.addInitScript((d) => { window.DATA = d; }, DATA);
await page.goto("file://" + HERE + "comp/index.html");
await page.waitForFunction(() => window.READY !== undefined);
await page.evaluate(() => window.READY);
const total = await page.evaluate(() => window.TOTAL);

const stillsArg = process.argv.indexOf("--stills");
if (stillsArg > -1) {
  for (const t of process.argv[stillsArg + 1].split(",").map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: `${OUT}still-${String(t).padStart(5, "0")}.png` });
    console.log("still", t);
  }
  await browser.close();
  process.exit(0);
}

const frames = Math.ceil(total * FPS);
const ff = spawn(ffmpegPath, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-i", HERE + "audio/narration.wav",
  "-map", "0:v", "-map", "1:a",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-shortest", OUT + "docspecialcare.mp4",
], { stdio: ["pipe", "inherit", "inherit"] });

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 300 === 0) console.log(`frame ${i}/${frames}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`✓ ${OUT}docspecialcare.mp4  ${total.toFixed(1)}s, ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
