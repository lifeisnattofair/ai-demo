// 동의 항목의 약관 본문과 「보기」 대화상자. 결제 약관(payment.js)과 가입 약관(auth.js)이 함께 씁니다.
// 본문은 가상 기관의 요약본입니다. 기준은 환불 규정(_shared/policy/refund.js), 보관 기간(DAR-005), 최소 수집(SER-004)입니다.
import { confirmDialog } from '../../components/dialog.js';

export const TERMS = {
  booking: {
    title: '예매 및 취소 수수료 규정',
    body: [
      '예매는 결제가 끝나야 확정됩니다. 좌석이나 인원은 선택한 때부터 10분 동안 선점되며, 시간이 지나면 다시 선택해야 합니다.',
      '취소 수수료는 관람일(체험일, 개강일) 기준으로 정합니다. 8일 전까지는 무료, 7일 전부터 4일 전까지는 결제 금액의 10%, 3일 전부터 1일 전까지는 30%이며, 당일에는 취소할 수 없습니다.',
      '정규 강좌는 개강 후 수강 진행 비율에 따라 환불액이 달라집니다. 기관 사정으로 회차가 취소되면 수수료 없이 전액 환불합니다.',
      '할인을 받은 경우 방문 당일 현장에서 증빙을 확인하며, 증빙이 없으면 차액을 현장에서 결제합니다.',
    ],
  },
  pgPrivacy: {
    title: '개인정보 제3자 제공(결제대행)',
    body: [
      '제공받는 곳: 결제대행사(가상)',
      '제공 항목: 주문번호, 결제 금액, 결제 수단 정보',
      '제공 목적: 결제 승인, 취소, 환불 처리',
      '보관 기간: 전자상거래법에 따라 결제와 환불 기록은 5년 동안 보관합니다.',
      '동의하지 않으실 수 있으나, 동의하지 않으면 결제를 진행할 수 없습니다.',
    ],
  },
  pgService: {
    title: '결제대행 서비스 이용약관',
    body: [
      '결제는 결제대행사(가상)의 결제창에서 이루어지며, 카드 번호 같은 결제 정보는 기관이 저장하지 않습니다.',
      '결제 승인, 취소, 환불 결과는 결제대행사의 처리 결과를 기준으로 합니다. 환불은 결제 수단에 따라 영업일 기준 3일에서 7일이 걸릴 수 있습니다.',
      '결제와 환불 기록은 전자상거래법에 따라 5년 동안 보관합니다.',
    ],
  },
  service: {
    title: '이용약관',
    body: [
      '이 서비스는 한빛아트센터의 공연 예매, 체험 신청, 정규 강좌 수강 신청을 위한 서비스입니다.',
      '회원은 본인 계정으로만 예약할 수 있으며, 1인 예약 한도(공연 회차당 4매, 체험 회차당 4명, 정규 강좌 1건) 안에서 이용합니다.',
      '예약의 취소와 환불은 예매 및 취소 수수료 규정을 따릅니다. 진행 중인 예약이 있으면 회원 탈퇴를 할 수 없습니다.',
    ],
  },
  privacy: {
    title: '개인정보 수집과 이용',
    body: [
      '수집 항목: 이메일, 이름, 휴대폰 번호',
      '이용 목적: 회원 확인, 예약과 취소 안내, 대기 순번 안내',
      '보관 기간: 회원 탈퇴 시 이름과 휴대폰 번호는 바로 삭제합니다. 결제와 환불 기록은 전자상거래법에 따라 5년 동안 보관합니다.',
      '장애, 보훈 여부 같은 민감정보와 증빙 파일은 수집하지 않습니다.',
      '동의하지 않으실 수 있으나, 동의하지 않으면 회원 가입을 할 수 없습니다.',
    ],
  },
};

/** 동의 행 한 줄: 체크 라벨 + 「보기」 버튼(라벨 밖에 두어 누를 때 체크가 바뀌지 않게 합니다). */
export function termRowHtml({ key, label, inputAttrs = '' }) {
  return `<div class="check-row"><label class="check"><input type="checkbox" ${inputAttrs}><span>${label}</span></label>`
    + `<button class="btn btn-text term-view" type="button" data-term-view="${key}" aria-label="${TERMS[key].title} 보기">보기</button></div>`;
}

/** root 안의 「보기」 버튼을 약관 대화상자에 연결합니다. */
export function bindTermViews(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-term-view]');
    if (!btn || !root.contains(btn)) return;
    const t = TERMS[btn.dataset.termView];
    if (!t) return;
    confirmDialog({ title: t.title, message: t.body, confirmLabel: '닫기', cancelLabel: null });
  });
}
