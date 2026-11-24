// 화면 설계서용 실제 화면 캡처: 시연 데이터 초기화 -> 화면 흐름으로 시연 활동 만들기 -> 화면별 캡처와 표시 번호 위치 저장
// 사용: node screens-capture.mjs   (로컬 앱 http://localhost:5174 와 로컬 Supabase 가 떠 있어야 합니다)
// 결과: deliverables/html/05_screens/*.webp, markers.json (build-screens.mjs 가 읽습니다)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { BASE, CHROME, createActivity, helpers, wait } from './screens-activity.mjs';
import { SCREENS } from './screens-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../deliverables/html/05_screens');
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2).filter((a) => a.startsWith('UI-'));

if (!process.argv.includes('--no-reset')) execSync('node reset-demo.mjs', { cwd: here, stdio: 'inherit' });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const h = helpers(page);
const result = {};
const byId = Object.fromEntries(SCREENS.map((s) => [s.id, s]));

const programId = (title) => execSync(`docker exec supabase_db_prototype psql -U postgres -tAc "select id from programs where title like '${title}%'"`).toString().trim();

// 요소 위치(뷰포트 기준). 여러 선택자 중 먼저 보이는 요소, text 가 있으면 그 글자를 가진 요소
async function locate(items) {
  return page.evaluate((items) => items.map((it, i) => {
    const list = [...document.querySelectorAll(it.sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return !it.text || e.textContent.trim() === it.text;
    });
    const e = list[0];
    if (!e) return { n: i + 1, found: false };
    const r = e.getBoundingClientRect();
    return { n: i + 1, found: true, x: r.left, y: r.top, w: r.width, h: r.height };
  }), items.map((it) => ({ sel: it.sel, text: it.text })));
}

async function shootPc(s, ctx) {
  await page.setViewport({ width: 1440, height: s.h, deviceScaleFactor: 1 });
  await s.go(ctx);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.mouse.move(1, 1);
  await wait(400);
  const markers = await locate(s.items);
  s.items.forEach((it, i) => {
    const m = markers[i];
    if (!m.found) { console.warn(`  ! ${s.id} #${i + 1} 요소 없음: ${it.sel}`); return; }
    if (it.offset) { m.x += it.offset[0]; m.y += it.offset[1]; m.noBox = true; }
  });
  // 사용자 화면은 본문 폭(1,280px) 바깥 여백을 잘라 크게 보입니다(관리자 화면은 전체 폭).
  const [x0, x1] = s.admin ? [0, 1440] : [96, 1344];
  markers.forEach((m) => { if (m.found) m.x -= x0; });
  const file = `${s.id}_pc.webp`;
  await page.screenshot({ path: resolve(OUT, file), type: 'webp', quality: 90, clip: { x: x0, y: 0, width: x1 - x0, height: s.h } });
  const r = { pc: { file, w: x1 - x0, h: s.h, markers } };

  if (s.inset) {
    await s.inset.go(ctx);
    await wait(300);
    const box = await page.evaluate((sel) => {
      let e = document.querySelector(sel);
      if (!e) return null;
      let rr = e.getBoundingClientRect();
      if (rr.width >= window.innerWidth * 0.9 && rr.height >= window.innerHeight * 0.9 && e.firstElementChild) {
        e = [...e.querySelectorAll('*')].find((c) => { const q = c.getBoundingClientRect(); return q.width < window.innerWidth * 0.8 && q.width > 200; }) ?? e;
        rr = e.getBoundingClientRect();
      }
      return { x: rr.left, y: rr.top, w: rr.width, h: rr.height };
    }, s.inset.sel);
    if (box) {
      const pad = 12;
      const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1440, box.w + pad * 2), height: Math.min(s.inset.maxH ?? 9999, box.h + pad * 2) };
      const ifile = `${s.id}_inset.webp`;
      await page.screenshot({ path: resolve(OUT, ifile), type: 'webp', quality: 90, clip });
      r.inset = { file: ifile, w: Math.round(clip.width), h: Math.round(clip.height), label: s.inset.label };
    } else console.warn(`  ! ${s.id} 덧붙임 요소 없음`);
    if (s.inset.after) await s.inset.after(ctx);
  }
  return r;
}

async function shootMobile(s, ctx) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await (s.mobileGo ?? s.go)(ctx);
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await wait(500);
  const file = `${s.id}_m.webp`;
  await page.screenshot({ path: resolve(OUT, file), type: 'webp', quality: 88 });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  return { file, w: 390, h: 844 };
}

async function capture(id, ctx) {
  const s = byId[id];
  if (only.length && !only.includes(id)) return;
  console.log(`- ${id}`);
  const r = await shootPc(s, ctx);
  if (s.mobile) r.mobile = await shootMobile(s, ctx);
  result[id] = r;
}

async function asGuest() {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

try {
  const act = process.argv.includes('--no-reset') ? null : await createActivity(page);
  if (act) writeFileSync(resolve(OUT, 'activity.json'), JSON.stringify(act, null, 1));
  const { log, ids } = act ?? JSON.parse((await import('node:fs')).readFileSync(resolve(OUT, 'activity.json'), 'utf8'));
  ids.chamberProgram = programId('겨울 실내악');
  const ctx = { page, ids, state: { potteryNo: log.m3a }, goto: (hash, settle = 1200) => h.goto(hash, { admin: ctx.admin, settle }) };

  // 비회원
  ctx.admin = false;
  await asGuest();
  await capture('UI-U01', ctx);
  await capture('UI-U02', ctx);
  await capture('UI-U15', ctx);

  // 회원: 선택 화면들
  await h.login('member3@demo.test');
  await capture('UI-U03', ctx);
  await capture('UI-U04', ctx);
  await capture('UI-U05', ctx);
  // 대기 신청 후, 다른 회원의 취소로 승격
  try { await h.joinWaitlist(ids.makeup2, 2); } catch (e) { console.warn(e.message); }
  await h.login('member1@demo.test');
  try { await h.cancelBooking(log.m1c); } catch (e) { console.warn(e.message); }

  // 회원: 선점 -> 할인 -> 결제 -> 결과
  await h.login('member3@demo.test');
  await page.setViewport({ width: 1440, height: 900 });
  await ctx.goto(`#/booking/${ids.chamber}/select`);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const id of ['86', '87']) { document.querySelector(`[data-seat-id="${id}"]`)?.click(); await sleep(150); }
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('다음: 할인'))?.click();
    await sleep(3000);
  });
  ctx.state.discountHash = new URL(page.url()).hash;
  ctx.state.payHash = ctx.state.discountHash.replace(/\/discount$/, '/pay');
  await capture('UI-U06', ctx);
  await capture('UI-U07', ctx);
  await capture('UI-U08', ctx);
  await capture('UI-U10', ctx);
  await capture('UI-U11', ctx);
  await capture('UI-U12', ctx);
  await capture('UI-U13', ctx);
  await capture('UI-U14', ctx);

  // 운영 담당
  ctx.admin = true;
  await h.login('operator@demo.test', { admin: true });
  for (const id of ['UI-A02', 'UI-A03', 'UI-A05', 'UI-A06', 'UI-A07', 'UI-A08', 'UI-A12', 'UI-A13']) await capture(id, ctx);
  // 정산 담당
  await h.login('finance@demo.test', { admin: true });
  for (const id of ['UI-A09', 'UI-A10', 'UI-A11']) await capture(id, ctx);

  let prev = {};
  try { prev = JSON.parse((await import('node:fs')).readFileSync(resolve(OUT, 'markers.json'), 'utf8')); } catch { /* 처음 */ }
  writeFileSync(resolve(OUT, 'markers.json'), JSON.stringify({ ...prev, ...result }, null, 1));
  console.log(JSON.stringify({ screens: Object.keys(result).length, state: ctx.state }));
} finally {
  await browser.close();
}
