// 지정 너비에서 가로 넘침 확인: node overflow.mjs <width> <html...>
// 페이지 전체 넘침과, 부모 상자 밖으로 삐져나온 요소(가로 스크롤 영역 안은 제외)를 함께 찾는다.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const [, , w, ...files] = process.argv;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const f of files) {
  const p = await b.newPage();
  await p.setViewport({ width: Number(w), height: 800 });
  await p.goto(pathToFileURL(resolve(f)).href, { waitUntil: 'networkidle0' });
  const r = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
    const bad = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > vw + 1 && !inScroller(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(rect.right)}`);
      const par = el.parentElement;
      if (par && !inScroller(el) && par !== document.body) {
        const pr = par.getBoundingClientRect();
        if (rect.right > pr.right + 2 && getComputedStyle(par).overflowX === 'visible') bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} > parent ${par.tagName.toLowerCase()}.${[...par.classList].join('.')} by ${Math.round(rect.right - pr.right)}px`);
      }
    }
    return { page: document.documentElement.scrollWidth > vw, bad: [...new Set(bad)].slice(0, 6) };
  });
  console.log(f.split('/').pop(), r.page ? 'PAGE-OVERFLOW' : '', r.bad.length ? r.bad.join(' | ') : 'ok');
  await p.close();
}
await b.close();
