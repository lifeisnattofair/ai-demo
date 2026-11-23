// HTML 파일을 캡처: node shot.mjs <html> <out.(png|webp)> [width] [height] [fullPage=1]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const [, , html, out, w = '1200', h = '800', full = '1', dsf = '1'] = process.argv;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: Number(dsf) });
  await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'networkidle0' });
  const type = out.endsWith('.webp') ? 'webp' : 'png';
  await page.screenshot({ path: resolve(out), fullPage: full === '1', type, ...(type === 'webp' ? { quality: 82 } : {}) });
} finally {
  await browser.close();
}
