// 검수용 시계(운영 담당, 검수/로컬 환경): 서버의 현재 기준 시각(app_now)을 앞당기거나 되돌립니다.
// 선점 10분, 대기 승격 24시간 같은 기한을 기다리지 않고 확인하려는 용도입니다. 판단은 모두 서버가 이 시각으로 합니다.
import { clockOffsetText, kstDateTime } from '../../lib/format.js';
import { describeError } from '../../lib/api.js';
import { withBusy } from '../../components/button-busy.js';
import { alertBox } from '../components/form.js';
import { loadInto, pageHead } from '../components/page.js';

const STEPS = [
  { label: '+10분', ms: 10 * 60 * 1000 },
  { label: '+1일', ms: 24 * 60 * 60 * 1000 },
  { label: '+24시간', ms: 24 * 60 * 60 * 1000 },
];

/**
 * @param {HTMLElement} el
 * @param {{api:{clock:()=>Promise<object>, setClock:(ms:number)=>Promise<object>}, onClock?:(clock:object)=>void}} ctx
 */
export async function renderSystemClock(el, { api, onClock = () => {} }) {
  el.innerHTML = `${pageHead({ crumbs: ['시스템', '검수용 시계'], title: '검수용 시계', help: '켜면 선점 만료, 대기 승격 기한, 환불 기준일이 아래 시각을 기준으로 판단됩니다. 검수 환경에서만 쓰세요.' })}
    <div class="alert-host"></div>
    <div class="sys-host"></div>`;
  const host = el.querySelector('.sys-host');
  const alerts = el.querySelector('.alert-host');
  let clock = await loadInto(host, 'form', () => api.clock());
  if (!clock) return;

  host.innerHTML = `<section class="card sys-card" aria-labelledby="clk-h">
      <div class="card-head"><h2 id="clk-h">현재 기준 시각</h2></div>
      <div class="sys-body">
        <p class="clock-now num"></p>
        <p class="clock-state"></p>
        <div class="sys-actions" role="group" aria-label="시계 조정">
          ${STEPS.map((s) => `<button class="btn" type="button" data-step="${s.ms}">${s.label}</button>`).join('')}
          <button class="btn" type="button" data-act="clear">초기화</button>
        </div>
      </div>
    </section>`;
  const buttons = [...host.querySelectorAll('button')];

  function draw() {
    host.querySelector('.clock-now').textContent = kstDateTime(clock.now);
    const text = clock.enabled ? clockOffsetText(clock.offsetMs) : '';
    host.querySelector('.clock-state').textContent = text ? `실제보다 ${text}입니다.` : '실제 시각과 같습니다.';
  }
  draw();

  async function apply(btn, offsetMs) {
    for (const b of buttons) if (b !== btn) b.disabled = true;
    await withBusy(btn, async () => {
      try {
        clock = await api.setClock(offsetMs);
        draw();
        onClock(clock);
        alertBox(alerts, offsetMs === 0 ? '검수용 시계를 실제 시각으로 되돌렸습니다.' : '검수용 시계를 적용했습니다. 상단 띠에서 확인할 수 있습니다.', 'ok');
      } catch (err) {
        alertBox(alerts, describeError(err));
      }
    });
    for (const b of buttons) b.disabled = false;
  }

  for (const b of host.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => apply(b, clock.offsetMs + Number(b.dataset.step)));
  }
  host.querySelector('[data-act="clear"]').addEventListener('click', (e) => apply(e.currentTarget, 0));
}
