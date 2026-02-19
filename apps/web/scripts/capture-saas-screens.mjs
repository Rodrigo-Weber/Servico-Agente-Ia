import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.CAPTURE_EMAIL ?? "admin@local";
const PASSWORD = process.env.CAPTURE_PASSWORD ?? "admin123";
const OUTPUT_DIR = path.resolve(process.cwd(), "src", "remotion", "assets", "saas-screens");

async function ensureDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(page, filename) {
  await page.screenshot({
    path: path.join(OUTPUT_DIR, filename),
    fullPage: false,
  });
}

async function gotoAndWait(page, label, expectedTitle) {
  await page.locator("aside nav button", { hasText: label }).first().click();
  if (expectedTitle) {
    await page.locator("header h1", { hasText: expectedTitle }).first().waitFor({ state: "visible", timeout: 15000 });
  }
  await wait(1200);
}

async function run() {
  await ensureDir();
  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await wait(800);

  const hasLogin = (await page.locator("#login-email").count()) > 0;
  if (hasLogin) {
    await capture(page, "01-login.png");
    await page.fill("#login-email", EMAIL);
    await page.fill("#login-password", PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).first().click();
    await page.locator("header h1").first().waitFor({ state: "visible", timeout: 20000 });
    await wait(1200);
  }

  await capture(page, "02-dashboard.png");

  await gotoAndWait(page, "Empresas", "Empresas");
  await capture(page, "03-empresas.png");

  await gotoAndWait(page, "Monitoramento", "Monitoramento");
  await capture(page, "04-monitoramento.png");

  await gotoAndWait(page, "IA e WhatsApp", "IA e WhatsApp");
  await capture(page, "05-ia-whatsapp.png");

  await gotoAndWait(page, "Visao geral", "WeberServicos");
  await capture(page, "06-visao-geral.png");

  await browser.close();
  console.log(`Screenshots salvos em: ${OUTPUT_DIR}`);
}

run().catch((error) => {
  console.error("Falha na captura das telas:", error);
  process.exit(1);
});

