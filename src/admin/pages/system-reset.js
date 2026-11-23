// 시연 데이터 초기화(운영 담당, 시연/로컬 환경): 예약, 대기, 알림, 모의 결제 기록을 지우고 시드 상태로 되돌립니다.
// 담당자와 회원 계정은 그대로입니다.
import { describeError } from '../../lib/api.js';
import { withBusy } from '../../components/button-busy.js';
import { confirmDialog } from '../../components/dialog.js';
import { alertBox } from '../components/form.js';
import { pageHead } from '../components/page.js';

/**
 * @param {HTMLElement} el
 * @param {{api:{resetDemo:()=>Promise<object>}}} ctx
 */
export function renderSystemReset(el, { api }) {
  el.innerHTML = `${pageHead({ crumbs: ['시스템', '시연 데이터 초기화'], title: '시연 데이터 초기화', help: '시연 후 처음 상태로 되돌릴 때 씁니다. 담당자와 회원 계정은 유지됩니다.' })}
    <div class="alert-host"></div>
    <section class="card sys-card" aria-labelledby="rst-h">
      <div class="card-head"><h2 id="rst-h">처음 상태로 되돌리기</h2></div>
      <div class="sys-body">
        <p>지워지는 항목: 예약, 결제와 환불 기록, 대기 신청, 알림, 작업 이력</p>
        <p>다시 만들어지는 항목: 프로그램과 회차 일정(지금 시각 기준), 좌석, 가격</p>
        <div class="sys-actions"><button class="btn btn-danger-solid" type="button" data-act="reset">시연 데이터 초기화</button></div>
      </div>
    </section>`;
  const alerts = el.querySelector('.alert-host');
  const btn = el.querySelector('[data-act="reset"]');
  btn.addEventListener('click', () => withBusy(btn, async () => {
    const ok = await confirmDialog({
      title: '시연 데이터를 초기화할까요?',
      message: '모든 예약, 대기, 알림이 지워지고 처음 상태로 돌아갑니다.',
      detail: '초기화한 뒤에는 되돌릴 수 없습니다.',
      confirmLabel: '초기화', cancelLabel: '닫기', danger: true,
    });
    if (!ok) return;
    try {
      await api.resetDemo();
      alertBox(alerts, '시연 데이터를 처음 상태로 되돌렸습니다.', 'ok');
    } catch (err) {
      alertBox(alerts, describeError(err));
    }
  }));
}
