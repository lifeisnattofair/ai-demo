// 화면 설계서 캡처 전에 시연 계정들이 실제 화면 흐름으로 예약, 결제, 취소, 대기, 회차 취소 요청을 만듭니다.
// 사용: node reset-demo.mjs && node screens-activity.mjs [http://localhost:5174]
// 관리자 화면에 실제 데이터가 보이고, 대기 신청과 승격, 회차 취소 승인 대기가 함께 보이게 합니다.
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

export const BASE = process.env.APP_BASE ?? 'http://localhost:5174';
export const PW = 'Demo-1234!';
export const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 로컬 DB에서 회차 ID 조회(초기화할 때마다 바뀜)
export function offeringId(title, nth = 0) {
  const sql = `select o.id from offerings o join programs p on p.id=o.program_id where p.title like '${title}%' order by o.starts_at`;
  return execSync(`docker exec supabase_db_prototype psql -U postgres -tAc "${sql}"`).toString().trim().split(/\s+/)[nth];
}

export function helpers(page) {
  async function login(email, { admin = false } = {}) {
    const url = admin ? `${BASE}/admin.html` : `${BASE}/#/login`;
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(admin ? `${BASE}/admin.html#/` : url, { waitUntil: 'networkidle0' });
    if (admin) await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(async ({ email, pw, admin }) => {
      const f = admin ? document.querySelector('form') : document.querySelector('main form');
      f.querySelector('[type=email]').value = email;
      f.querySelector('[type=password]').value = pw;
      f.requestSubmit();
      await new Promise((r) => setTimeout(r, 2500));
    }, { email, pw: PW, admin });
  }

  async function goto(hash, { admin = false, settle = 900 } = {}) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/${admin ? 'admin.html' : ''}${hash}`, { waitUntil: 'networkidle0' });
    await wait(settle);
  }

  // 선택 화면에서 결제 완료까지 화면 흐름 그대로 진행. 예약번호를 돌려줍니다.
  async function book(offering, { seats = [], qty = 1, discounts = [] } = {}) {
    await page.setViewport({ width: 1440, height: 900 });
    await goto(`#/booking/${offering}/select`, { settle: 600 });
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

  // 내 예약에서 예약번호로 찾아 예약 상세에서 취소
  async function cancelBooking(bookingNo) {
    await goto('#/me/bookings');
    const href = await page.evaluate((no) => [...document.querySelectorAll('a')].find((a) => a.textContent.includes(no))?.getAttribute('href'), bookingNo);
    if (!href) throw new Error(`예약 ${bookingNo} 없음`);
    await page.goto(`${BASE}/${href}`, { waitUntil: 'networkidle0' });
    await wait(800);
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '예약 취소')?.click(); await sleep(1500);
      [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === '예약 취소하기')?.click(); await sleep(3000);
    });
  }

  // 매진 회차에서 대기 신청
  async function joinWaitlist(offering, qty) {
    await goto(`#/booking/${offering}/select`, { settle: 1200 });
    await page.evaluate(async (qty) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 1; i < qty; i++) { document.querySelector('main [data-step="1"]')?.click(); await sleep(150); }
      [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '대기 신청하기')?.click();
      await sleep(3000);
    }, qty);
  }

  // 운영 담당: 회차 정원 변경(회차 수정 화면)
  async function setCapacity(offering, capacity) {
    await goto(`#/offerings/${offering}`, { admin: true, settle: 1500 });
    await page.evaluate(async (capacity) => {
      const f = document.querySelector('#f-capacity');
      f.value = String(capacity); f.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '저장')?.click();
      await new Promise((r) => setTimeout(r, 2500));
    }, capacity);
  }

  // 운영 담당: 회차 취소 요청
  async function requestCancel(offering, reason) {
    await goto('#/cancel-requests', { admin: true, settle: 1500 });
    await page.evaluate(async ({ offering, reason }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const s = document.querySelector('#f-offering'); s.value = offering; s.dispatchEvent(new Event('change', { bubbles: true }));
      const t = document.querySelector('#f-reason'); t.value = reason; t.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.cancel-form button[type=submit]').click(); await sleep(800);
      [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === '취소 요청')?.click(); await sleep(2500);
    }, { offering, reason });
  }

  // 정산 담당: 회차 취소 승인(첫 승인 대기 건)
  async function approveFirstCancel() {
    await goto('#/cancel-requests', { admin: true, settle: 1500 });
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '승인')?.click(); await sleep(800);
      [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === '승인하고 환불')?.click(); await sleep(4000);
    });
  }

  return { login, goto, book, cancelBooking, joinWaitlist, setCapacity, requestCancel, approveFirstCancel };
}

export async function createActivity(page) {
  const h = helpers(page);
  const chamber = offeringId('겨울 실내악');
  const chamber2 = offeringId('겨울 실내악', 1);
  const theater = offeringId('한빛 청소년');
  const pottery = offeringId('가족 도자기');
  const pottery2 = offeringId('가족 도자기', 1);
  const makeup = offeringId('무대 분장');
  const makeup2 = offeringId('무대 분장', 1);
  const choir = offeringId('시민 합창');
  const water = offeringId('생활 수채화');
  const log = {};

  await h.login('member1@demo.test');
  log.m1a = await h.book(chamber, { seats: [65, 66], discounts: ['장애인 50', '장애인 동반'] });
  log.m1b = await h.book(makeup, { qty: 2 });
  await h.cancelBooking(log.m1b);
  log.m1c = await h.book(makeup2, { qty: 4 });

  await h.login('member2@demo.test');
  log.m2a = await h.book(theater, { seats: [45, 46, 47] });
  log.m2b = await h.book(choir);
  log.m2c = await h.book(makeup2, { qty: 4 });
  log.m2d = await h.book(chamber2, { seats: [101, 102] });
  log.m2e = await h.book(pottery2, { qty: 2 });

  await h.login('member3@demo.test');
  log.m3a = await h.book(pottery, { qty: 3, discounts: ['일반', '다자녀', '다자녀'] });
  log.m3b = await h.book(water);

  // 무대 분장 12월 회차를 매진으로: 운영 담당이 정원을 판매 수량(8명)으로 줄입니다.
  await h.login('operator@demo.test', { admin: true });
  await h.setCapacity(makeup2, 8);
  // 기관 사정 취소: 실내악 2회차는 승인까지, 도자기 2회차는 승인 대기로 둡니다.
  await h.requestCancel(chamber2, '연주자 건강 문제로 공연을 진행할 수 없어 회차를 취소합니다.');
  await h.login('finance@demo.test', { admin: true });
  await h.approveFirstCancel();
  await h.login('operator@demo.test', { admin: true });
  await h.requestCancel(pottery2, '공방 가마 점검 일정과 겹쳐 수업 장소를 쓸 수 없습니다.');

  return { log, ids: { chamber, chamber2, theater, pottery, pottery2, makeup, makeup2, choir, water } };
}

if (process.argv[1]?.endsWith('screens-activity.mjs')) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    const r = await createActivity(page);
    console.log(JSON.stringify(r, null, 1));
  } finally {
    await browser.close();
  }
}
