// 프로토타입 화면 캡처(포트폴리오용): PC 1440 x 900, 모바일 390 x 844, 전체 페이지, webp 82
// 사용: node reset-demo.mjs && node proto-shots.mjs http://localhost:5174
// 초기화 직후 시연 계정들이 화면 흐름으로 예약, 결제, 취소를 몇 건 만든 뒤 캡처합니다(관리자 화면에 실제 데이터가 보이게).
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../portfolio/shots/prototype');
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] ?? 'http://localhost:5174';
const PW = 'Demo-1234!';
const SIZES = [['pc', 1440, 900], ['mobile', 390, 844]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const shots = [];

async function shoot(name, url, { before } = {}) {
  for (const [tag, w, h] of SIZES) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await wait(600);
    if (before) await before();
    await wait(300);
    const file = resolve(OUT, `${name}_${tag}.webp`);
    await page.screenshot({ path: file, fullPage: true, type: 'webp', quality: 82 });
    shots.push(file);
  }
}
async function login(url, email, admin = false) {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(async ({ email, pw, admin }) => {
    const f = admin ? document.querySelector('form') : document.querySelector('main form');
    f.querySelector('[type=email]').value = email;
    f.querySelector('[type=password]').value = pw;
    f.requestSubmit();
    await new Promise((r) => setTimeout(r, 2500));
  }, { email, pw: PW, admin });
}

// 로컬 DB에서 회차 ID 조회(초기화할 때마다 바뀜)
function offeringId(title, nth = 0) {
  const sql = `select o.id from offerings o join programs p on p.id=o.program_id where p.title like '${title}%' order by o.starts_at`;
  return execSync(`docker exec supabase_db_prototype psql -U postgres -tAc "${sql}"`).toString().trim().split(/\s+/)[nth];
}
// 선택 화면에서 결제 완료까지 화면 흐름 그대로 진행
async function book(offering, { seats = [], qty = 1, discounts = [] } = {}) {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/#/booking/${offering}/select`, { waitUntil: 'networkidle0' });
  await wait(500);
  return page.evaluate(async ({ seats, qty, discounts }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(t));
    for (const id of seats) { document.querySelector(`[data-seat-id="${id}"]`)?.click(); await sleep(100); }
    for (let i = 1; i < qty; i++) { btn('+')?.click(); await sleep(100); }
    btn('다음: 할인')?.click(); await sleep(2500);
    const sel = [...document.querySelectorAll('main select')];
    discounts.forEach((label, i) => {
      const s = sel[i]; if (!s) return;
      const o = [...s.options].find((x) => x.text.startsWith(label)); if (!o) return;
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    btn('다음: 결제')?.click(); await sleep(2500);
    document.querySelector('input[name=pm][value=CARD]')?.click(); await sleep(150);
    document.querySelector('main input[type=checkbox]')?.click();
    const card = document.querySelector('main select');
    if (card) { card.value = card.options[1].value; card.dispatchEvent(new Event('change', { bubbles: true })); }
    await sleep(300);
    btn('결제하기')?.click(); await sleep(3500);
    return document.querySelector('main').innerText.match(/B\d{8}/)?.[0] ?? null;
  }, { seats, qty, discounts });
}
async function cancelLatest() {
  await page.goto(`${BASE}/#/me/bookings`, { waitUntil: 'networkidle0' });
  await wait(800);
  const href = await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => /^예약번호/.test(a.textContent.trim()))?.getAttribute('href'));
  await page.goto(href.startsWith('http') ? href : `${BASE}/${href}`, { waitUntil: 'networkidle0' });
  await wait(800);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '예약 취소')?.click(); await sleep(1500);
    [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === '예약 취소하기')?.click(); await sleep(3000);
  });
}

const firstHref = (sel, text) => page.evaluate(({ sel, text }) => [...document.querySelectorAll(sel)].find((a) => a.textContent.trim().includes(text))?.getAttribute('href'), { sel, text });

try {
  // 시연 활동 만들기
  const chamber = offeringId('겨울 실내악');
  const theater = offeringId('한빛 청소년');
  const pottery = offeringId('가족 도자기');
  const makeup = offeringId('무대 분장');
  const choir = offeringId('시민 합창');
  const water = offeringId('생활 수채화');
  await login(`${BASE}/#/login`, 'member1@demo.test');
  await book(chamber, { seats: [65, 66], discounts: ['장애인 50', '장애인 동반'] });
  await book(makeup, { qty: 2 });
  await cancelLatest();
  await login(`${BASE}/#/login`, 'member2@demo.test');
  await book(theater, { seats: [45, 46, 47] });
  await book(choir);
  await login(`${BASE}/#/login`, 'member3@demo.test');
  await book(pottery, { qty: 3, discounts: ['일반', '다자녀', '다자녀'] });
  await book(water);

  // 비회원 화면
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await shoot('u01_home', `${BASE}/#/`);
  await shoot('u02_programs', `${BASE}/#/programs`);
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  const detail = await firstHref('main a', '예매하기');
  await shoot('u03_detail', `${BASE}/${detail}`);

  // 회원 예매 흐름
  await login(`${BASE}/#/login`, 'member3@demo.test');
  const select = `#/booking/${chamber}/select`;
  await shoot('u04_seats', `${BASE}/${select}`, {
    before: async () => {
      await page.evaluate(() => { for (const id of ['86', '87']) document.querySelector(`[data-seat-id="${id}"]`)?.click(); });
    },
  });
  // 선점을 하나 만들고 할인, 결제 단계를 캡처
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/${select}`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    for (const id of ['86', '87']) document.querySelector(`[data-seat-id="${id}"]`)?.click();
    await new Promise((r) => setTimeout(r, 200));
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('다음: 할인'))?.click();
    await new Promise((r) => setTimeout(r, 2500));
  });
  const discountUrl = page.url();
  await shoot('u05_discount', discountUrl);
  await shoot('u06_payment', discountUrl.replace(/\/discount$/, '/pay'), {
    before: async () => {
      await page.evaluate(() => {
        document.querySelector('input[name=pm][value=CARD]')?.click();
        document.querySelector('main input[type=checkbox]')?.click();
      });
    },
  });
  await shoot('u07_my_bookings', `${BASE}/#/me/bookings`);
  await shoot('u08_my_waitlist', `${BASE}/#/me/waitlist`);
  await shoot('u09_notifications', `${BASE}/#/me/notifications`);

  // 관리자
  await login(`${BASE}/admin.html`, 'operator@demo.test', true);
  await shoot('a01_dashboard', `${BASE}/admin.html#/`);
  await shoot('a02_offerings', `${BASE}/admin.html#/offerings`);
  await shoot('a03_bookings', `${BASE}/admin.html#/bookings`);
  await shoot('a04_waitlist', `${BASE}/admin.html#/waitlist`);
  await login(`${BASE}/admin.html`, 'finance@demo.test', true);
  await shoot('a05_payments', `${BASE}/admin.html#/payments`);
  await shoot('a06_settlement', `${BASE}/admin.html#/settlement`, {
    before: async () => {
      await page.evaluate(async () => {
        const d = [...document.querySelectorAll('main input[type=date]')];
        const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        const to = d[1].value; const t = new Date(`${to}T00:00:00`); t.setDate(t.getDate() - 6);
        set(d[0], `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
        [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '조회')?.click();
        await new Promise((r) => setTimeout(r, 1500));
      });
    },
  });
  await shoot('a07_audit', `${BASE}/admin.html#/audit`);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ count: shots.length, dir: OUT }));
