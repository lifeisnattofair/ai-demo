// 시연 데이터 초기화(운영 담당 화면 조작): node reset-demo.mjs
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.goto('http://localhost:5174/admin.html#/system/reset', { waitUntil: 'networkidle0' });
const r = await p.evaluate(async () => {
  const f = document.querySelector('form'); f.email.value = 'operator@demo.test'; f.password.value = 'Demo-1234!'; f.requestSubmit();
  await new Promise((r) => setTimeout(r, 3000));
  [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === '시연 데이터 초기화').click();
  await new Promise((r) => setTimeout(r, 700));
  [...document.querySelectorAll('[role=dialog] button')].find((x) => /초기화/.test(x.textContent)).click();
  await new Promise((r) => setTimeout(r, 4000));
  return document.querySelector('main').innerText.includes('처음 상태로 되돌렸습니다');
});
console.log('reset', r);
await b.close();
