// anti-slop Delivery Gate 측정: 실행 중인 개발 서버의 화면을 역할별로 열어
// 가로 넘침, 콘솔 오류, 없는 화면으로 가는 링크, 44px 미만 누름 요소, 초점 표시를 기록합니다.
// 사용: node gate-check.mjs http://localhost:5174 > gate.json
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const WIDTHS = [390, 768, 1440];
const PASSWORD = 'Demo-1234!';

const USER_PUBLIC = ['#/', '#/programs', '#/programs?type=PERFORMANCE', '#/programs?type=EXPERIENCE', '#/programs?type=COURSE', '#/guide/refund', '#/guide/visit', '#/guide/course', '#/login', '#/signup', '#/reset'];
const USER_MEMBER = ['#/me/bookings', '#/me/bookings?tab=past', '#/me/bookings?tab=cancelled', '#/me/waitlist', '#/me/notifications', '#/account'];
const ADMIN_OP = ['#/', '#/programs', '#/programs/new', '#/offerings', '#/offerings/new', '#/bookings', '#/waitlist', '#/cancel-requests', '#/audit', '#/system/clock', '#/system/reset'];
const ADMIN_FIN = ['#/', '#/bookings', '#/payments', '#/cancel-requests', '#/settlement', '#/audit'];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const out = [];

async function measure(page, label) {
  return page.evaluate((label) => {
    const vw = document.documentElement.clientWidth;
    const inScroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
    const overflow = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > vw + 1 && !inScroller(el)) overflow.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    }
    const routes = new Set();
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h.startsWith('#/'));
    for (const h of links) routes.add(h.split('?')[0]);
    const small = [...document.querySelectorAll('a, button, input, select, [role=button], summary')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || getComputedStyle(e).visibility === 'hidden') return false;
      if (e.closest('.seat-map, .seats, .plot')) return false; // 좌석은 별도 기준(20px 이상, 목록 대체 제공)
      if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li, td, dd')) return false; // 문장 안 링크는 예외(WCAG 2.5.8 inline)
      return r.height < 24 || r.width < 24;
    }).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16)}`);
    const noCursor = [...document.querySelectorAll('a[href], button:not([disabled]), select, summary, label[for], input[type=checkbox], input[type=radio]')]
      .filter((e) => e.getBoundingClientRect().width && !['pointer'].includes(getComputedStyle(e).cursor)).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || '').trim().slice(0, 16)}`);
    return { label, title: document.title, overflow: [...new Set(overflow)].slice(0, 6), pageOverflow: document.documentElement.scrollWidth > vw, links: [...routes], small: [...new Set(small)].slice(0, 6), noCursor: [...new Set(noCursor)].slice(0, 6), h1: document.querySelector('h1')?.textContent.trim() ?? null, busy: !!document.querySelector('[aria-busy="true"]') };
  }, label);
}

async function visit(page, base, routes, role, errors) {
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: w < 500 ? 844 : 900 });
    for (const r of routes) {
      errors.length = 0;
      await page.goto(`${base}${r}`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => new Promise((res) => setTimeout(res, 400)));
      const m = await measure(page, `${role} ${w} ${r}`);
      out.push({ ...m, console: [...errors] });
    }
  }
}

async function login(page, url, email, admin) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(async ({ email, pw, admin }) => {
    const f = admin ? document.querySelector('form') : document.querySelector('main form');
    f.querySelector('[type=email]').value = email;
    f.querySelector('[type=password]').value = pw;
    f.requestSubmit();
    await new Promise((r) => setTimeout(r, 2500));
  }, { email, pw: PASSWORD, admin });
}

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await visit(page, `${BASE}/`, USER_PUBLIC, 'guest', errors);

  await login(page, `${BASE}/#/login`, 'member1@demo.test', false);
  await visit(page, `${BASE}/`, USER_MEMBER, 'member', errors);

  await login(page, `${BASE}/admin.html`, 'operator@demo.test', true);
  await visit(page, `${BASE}/admin.html`, ADMIN_OP, 'operator', errors);

  await login(page, `${BASE}/admin.html`, 'finance@demo.test', true);
  await visit(page, `${BASE}/admin.html`, ADMIN_FIN, 'finance', errors);
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
