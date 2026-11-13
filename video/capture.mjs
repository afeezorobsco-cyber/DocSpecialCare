// Walks the real DocSpecialCare journey on the live site and captures
// high-resolution screenshots + highlight boxes for the video.
//   node capture.mjs [baseUrl]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "fs";

const BASE = process.argv[2] || "https://docspecialcare.vercel.app";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const VW = 1600, VH = 900;

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("dialog", async (d) => { if (d.type() === "alert") errors.push(d.message()); await d.accept(); });
const meta = {};
const btn = (name) => page.getByRole("button", { name, exact: false });
const idle = async () => {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  if (errors.length) throw new Error("App error: " + errors.join(" | "));
};

/** Screenshot the viewport; highlights = [{ loc, label }] in CSS px of the 1600x900 viewport. */
async function snap(name, highlights = []) {
  await page.waitForTimeout(600);
  const boxes = [];
  for (const h of highlights) {
    const b = await h.loc.first().boundingBox();
    if (b) boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, label: h.label || "" });
  }
  await page.screenshot({ path: `${OUT}${name}.png` });
  meta[name] = { w: VW, h: VH, boxes };
  console.log("📸", name, boxes.map((b) => b.label).join(", "));
}

async function as(label) {
  await page.goto(BASE + "/app");
  await page.waitForSelector("text=/Sign out|Or try the demo/", { timeout: 60000 });
  if (await btn("Sign out").isVisible().catch(() => false)) {
    await btn("Sign out").click();
    await page.waitForSelector("text=Or try the demo", { timeout: 30000 });
  }
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.waitForSelector("text=Loading from NEAR…", { state: "detached", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);
}

async function pickSlot() {
  await page.locator(".fixed").getByRole("button").filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/ }).first().click();
  await page.waitForTimeout(2500);
  const free = page.locator(".fixed .grid button:not([disabled])");
  await free.nth(Math.min(4, (await free.count()) - 1)).click();
}

// --- landing
await page.goto(BASE + "/");
await page.waitForTimeout(1500);
await snap("landing");

// --- patient: login screen + dashboard + booking
await page.goto(BASE + "/app");
await page.waitForSelector("text=/Sign out|Or try the demo/");
if (await btn("Sign out").isVisible().catch(() => false)) { await btn("Sign out").click(); await page.waitForSelector("text=Or try the demo"); }
await snap("login", [{ loc: page.getByText("Or try the demo as…"), label: "Demo personas" }]);
await as("Patient");
await snap("patient-home", [{ loc: page.getByText("Dr. Tunde Bello").first(), label: "General physician" }]);
await btn("Book").first().click();
await page.waitForTimeout(800);
await pickSlot();
await snap("book", [
  { loc: page.locator(".fixed .grid button.bg-teal-700"), label: "Pick a time" },
  { loc: btn("& book"), label: "Pay 0.1 NEAR into escrow" },
]);
await btn("& book").click();
await idle();
await snap("booked", [{ loc: page.getByText("in escrow").first(), label: "Money held by NEAR" }]);

// --- consultation chat
await btn("Open consultation").first().click();
await page.waitForTimeout(3000);
await page.getByPlaceholder("Type a message").fill("Good morning doctor. I get chest pains when I climb stairs.");
await page.locator(".fixed form button").click();
await page.waitForTimeout(2000);
await snap("consult", [
  { loc: page.getByText("chest pains"), label: "Private, encrypted chat" },
  { loc: page.getByText("Join private video call"), label: "Private video call" },
]);

// --- GP refers + completes
await as("Tunde");
await btn("Open consultation").first().click();
await page.waitForTimeout(5000);
await snap("gp-chat", [{ loc: page.getByText("chest pains"), label: "Doctor reads her message" }]);
await page.getByLabel("Close").click();
await btn("Clinical actions").first().click();
await page.getByRole("button", { name: "Refer", exact: true }).click();
await page.locator(".fixed select").selectOption({ index: 1 });
await page.locator(".fixed textarea").fill("Chest pain on exertion for 3 weeks. Blood pressure 150/95. Please assess for angina.");
await snap("refer", [
  { loc: page.locator(".fixed select"), label: "Heart specialist" },
  { loc: btn("Send referral"), label: "Referral recorded on NEAR" },
]);
await btn("Send referral").click();
await idle();
await btn("Clinical actions").first().click();
await page.getByRole("button", { name: "Complete", exact: true }).click();
await snap("complete", [{ loc: btn("Complete & get paid"), label: "Fee released to doctor" }]);
await btn("Complete & get paid").click();
await idle();
await snap("gp-paid", [{ loc: page.getByText(/Earned via escrow/), label: "Doctor paid automatically" }]);

// --- patient books specialist with referral
await as("Patient");
await snap("referral-card", [{ loc: btn("Book specialist"), label: "Book with referral" }]);
await btn("Book specialist").first().click();
await page.waitForTimeout(800);
await pickSlot();
await btn("& book").click();
await idle();

// --- specialist orders test
await as("Ngozi");
await btn("Clinical actions").first().click();
await page.getByRole("button", { name: "Order test", exact: true }).click();
await page.locator(".fixed select").selectOption({ index: 1 });
await page.locator(".fixed textarea").fill("Full blood count\nLipid profile\nTroponin I");
await snap("order", [{ loc: page.locator(".fixed textarea"), label: "Tests requested" }]);
await page.locator(".fixed").getByRole("button", { name: "Order test" }).last().click();
await idle();

// --- patient pays lab
await as("Patient");
await snap("pay-lab", [{ loc: page.getByRole("button", { name: /^Pay .* NEAR$/ }), label: "Pay the lab safely" }]);
await page.getByRole("button", { name: /^Pay .* NEAR$/ }).first().click();
await idle();

// --- lab uploads result
await as("CityLab");
await btn("Upload result").first().click();
await page.locator(".fixed textarea").fill("Troponin I: 0.01 ng/mL (normal)\nLDL cholesterol: 4.6 mmol/L (high)\nHaemoglobin: 13.2 g/dL (normal)");
await snap("lab-upload", [{ loc: btn("Encrypt & submit"), label: "Locked before it leaves the lab" }]);
await btn("Encrypt & submit").click();
await idle();

// --- specialist verifies + prescribes
await as("Ngozi");
await btn("Result").first().click();
await page.waitForSelector("text=Integrity verified", { timeout: 60000 });
await snap("verify", [
  { loc: page.getByText("Integrity verified"), label: "Matches the fingerprint on NEAR" },
  { loc: page.getByText("LDL cholesterol"), label: "Decrypted on her screen" },
]);
await page.getByLabel("Close").click();
await btn("Clinical actions").first().click();
await page.getByRole("button", { name: "Prescribe", exact: true }).click();
await page.getByPlaceholder("Medication").fill("Atorvastatin");
await page.getByPlaceholder("Dose e.g. 500mg").fill("20 mg");
await page.getByPlaceholder("e.g. twice daily").fill("Once nightly");
await page.getByPlaceholder("Days").fill("30");
await page.locator(".fixed textarea").fill("Take at night. Review in 4 weeks.");
await snap("prescribe", [{ loc: btn("Sign & issue"), label: "Signed by a verified doctor" }]);
await btn("Sign & issue").click();
await idle();
await btn("Clinical actions").first().click();
await page.getByRole("button", { name: "Complete", exact: true }).click();
await btn("Complete & get paid").click();
await idle();

// --- patient sends to pharmacy
await as("Patient");
await page.locator("select").first().selectOption({ index: 1 });
await snap("choose-pharmacy", [{ loc: page.locator("select").first(), label: "Her nearest pharmacy" }]);
await btn("Send to pharmacy").click();
await idle();
await page.waitForTimeout(5000);

// --- pharmacy views + quotes
await as("HealthPlus");
await btn("View").first().click();
await page.waitForSelector("text=Atorvastatin", { timeout: 60000 });
await snap("pharmacy-rx", [{ loc: page.getByText("Atorvastatin"), label: "Only this pharmacy can read it" }]);
await page.getByLabel("Close").click();
await page.getByPlaceholder("Price NEAR").first().fill("0.05");
await btn("Send quote").first().click();
await idle();

await as("Patient");
await page.getByRole("button", { name: /^Pay .* NEAR$/ }).first().click();
await idle();

await as("HealthPlus");
await snap("dispense", [{ loc: btn("Dispense"), label: "Hand over the medicine" }]);
await btn("Dispense").first().click();
await idle();
const rxId = (await page.textContent("main")).match(/Rx #(\d+)/)?.[1] || "1";
await page.getByPlaceholder("Prescription #").fill(rxId);
await page.locator("section", { hasText: "Verify a prescription" }).getByRole("button", { name: "Check" }).click();
await page.waitForTimeout(3000);
await snap("verify-rx", [{ loc: page.locator("dl"), label: "Genuine, and already used" }]);

// --- proof on NearBlocks
const contract = (await page.textContent("main")).match(/contract\s*(\S+?\.testnet)/)?.[1];
const nb = await ctx.newPage();
await nb.goto(`https://testnet.nearblocks.io/address/${contract}`, { waitUntil: "domcontentloaded" });
await nb.waitForTimeout(9000);
await nb.screenshot({ path: `${OUT}nearblocks.png` });
meta.nearblocks = { w: VW, h: VH, boxes: [] };
console.log("📸 nearblocks");

writeFileSync(`${OUT}meta.json`, JSON.stringify({ contract, rxId, shots: meta }, null, 2));
await browser.close();
console.log("done", contract);
