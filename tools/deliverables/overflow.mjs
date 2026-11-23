// 지정 너비에서 가로 넘침 확인: node overflow.mjs <width> <html...>
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
const [, , w, ...files] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const f of files) {
  const p = await b.newPage();
  await p.setViewport({ width: Number(w), height: 800 });
  await p.goto(pathToFileURL(resolve(f)).href, { waitUntil: 'networkidle0' });
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(f, r.sw > r.cw ? `OVERFLOW ${r.sw}/${r.cw}` : 'ok');
  await p.close();
}
await b.close();
