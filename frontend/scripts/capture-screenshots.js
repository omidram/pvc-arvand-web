const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = path.join(__dirname, "..", "..", "docs", "screenshots");
const BASE = "http://127.0.0.1:3001";
const API = "http://127.0.0.1:8010";
fs.mkdirSync(OUT, { recursive: true });

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${API}${urlPath}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw || "{}") });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", name, fs.statSync(file).size);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const text = await page.locator("body").innerText();
  console.log("login body snippet:", JSON.stringify(text.slice(0, 200)));
  await shot(page, "01-login");

  const login = await postJson("/api/auth/login", { username: "admin", password: "admin123" });
  if (login.status !== 200 || !login.json.access_token) {
    throw new Error("API login failed: " + JSON.stringify(login));
  }
  await page.evaluate((token) => localStorage.setItem("pvc-arvand-token", token), login.json.access_token);
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  console.log("menu body snippet:", JSON.stringify((await page.locator("body").innerText()).slice(0, 200)));
  await shot(page, "02-main-menu");

  const routes = [
    ["/elements", "03-element-admin"],
    ["/elements/assembly", "04-assembly-data"],
    ["/voltage?form=readings", "05-voltage-readings"],
    ["/analyses", "06-analysis"],
    ["/inspections", "07-inspections"],
    ["/segregation", "08-segregation"],
    ["/overview", "09-overview"],
  ];
  for (const [route, name] of routes) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
    await shot(page, name);
  }

  await browser.close();
  console.log("DONE", fs.readdirSync(OUT).join(", "));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
