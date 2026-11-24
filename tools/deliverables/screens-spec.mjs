// 화면 설계서(HB-PMO-UI-01) 화면 정의: 화면 목록, 화면별 캡처 방법, 표시 번호(마커) 위치를 찾을 요소, 설명.
// 캡처(screens-capture.mjs)와 문서 생성(build-screens.mjs)이 함께 씁니다. 설명은 src/ 의 실제 동작을 기준으로 적습니다.

export const ROLE = { G: '비회원', M: '회원', O: '운영 담당', F: '정산 담당' };

// 화면 목록(설계 대상 전체). detail: 화면별 설계 쪽이 있는 화면
export const SCREEN_LIST = [
  { id: 'UI-U01', name: '홈, 프로그램 목록', path: '#/, #/programs', users: 'G,M', reqs: 'SFR-003, PER-001, QUR-003', detail: true },
  { id: 'UI-U02', name: '프로그램 상세, 회차 선택', path: '#/programs/:id', users: 'G,M', reqs: 'SFR-004, SFR-013, SFR-014', detail: true },
  { id: 'UI-U03', name: '좌석 선택(공연)', path: '#/booking/:offeringId/select', users: 'M', reqs: 'SFR-005, SFR-007, SFR-008, PER-004, QUR-001', detail: true },
  { id: 'UI-U04', name: '인원 선택(체험, 정규 강좌)', path: '#/booking/:offeringId/select', users: 'M', reqs: 'SFR-006, SFR-007, SFR-008', detail: true },
  { id: 'UI-U05', name: '대기 신청', path: '#/booking/:offeringId/select (매진)', users: 'M', reqs: 'SFR-015, SFR-016, SFR-008', detail: true },
  { id: 'UI-U06', name: '할인 선택', path: '#/booking/:holdId/discount', users: 'M', reqs: 'SFR-009, SFR-007, DAR-003', detail: true },
  { id: 'UI-U07', name: '결제', path: '#/booking/:holdId/pay', users: 'M', reqs: 'SFR-010, SFR-011, SIR-001, SER-007', detail: true },
  { id: 'UI-U08', name: '결제 결과(성공)', path: '#/payment/success', users: 'M', reqs: 'SFR-010, SFR-011, SIR-002, QUR-007', detail: true },
  { id: 'UI-U09', name: '결제 결과(실패)', path: '#/payment/fail', users: 'M', reqs: 'SFR-010, QUR-007', detail: false },
  { id: 'UI-U10', name: '내 예약 목록', path: '#/me/bookings', users: 'M', reqs: 'SFR-012, SFR-016', detail: true },
  { id: 'UI-U11', name: '예약 상세, 예약 취소', path: '#/me/bookings/:id', users: 'M', reqs: 'SFR-012, SFR-013, SFR-014, DAR-003, DAR-004', detail: true },
  { id: 'UI-U12', name: '대기 신청 목록', path: '#/me/waitlist', users: 'M', reqs: 'SFR-015, SFR-016', detail: true },
  { id: 'UI-U13', name: '알림함', path: '#/me/notifications', users: 'M', reqs: 'SFR-017', detail: true },
  { id: 'UI-U14', name: '회원 정보', path: '#/account', users: 'M', reqs: 'SFR-002, SER-001, SER-004', detail: true },
  { id: 'UI-U15', name: '회원 가입(계정 정보, 약관 동의, 연락처 입력)', path: '#/signup, #/signup/contact', users: 'G', reqs: 'SFR-001, SIR-005, SIR-006, SER-004', detail: true },
  { id: 'UI-U16', name: '로그인', path: '#/login', users: 'G', reqs: 'SFR-001, SER-001', detail: false },
  { id: 'UI-U17', name: '비밀번호 재설정', path: '#/reset', users: 'G', reqs: 'SFR-001, SIR-005', detail: false },
  { id: 'UI-U18', name: '이용 안내(취소/환불 규정, 관람 안내, 수강 신청 안내)', path: '#/guide/refund, #/guide/visit, #/guide/course', users: 'G,M', reqs: 'SFR-013, SFR-014', detail: false },
  { id: 'UI-A01', name: '관리자 로그인, 접근 거부', path: 'admin.html', users: 'O,F', reqs: 'SFR-018, SER-001, SER-002', detail: false },
  { id: 'UI-A02', name: '대시보드', path: 'admin.html#/', users: 'O,F', reqs: 'SFR-018', detail: true },
  { id: 'UI-A03', name: '프로그램 목록', path: 'admin.html#/programs', users: 'O', reqs: 'SFR-019', detail: true },
  { id: 'UI-A04', name: '프로그램 등록, 수정', path: 'admin.html#/programs/new, #/programs/:id', users: 'O', reqs: 'SFR-019, SER-006', detail: false },
  { id: 'UI-A05', name: '회차/좌석 관리(목록)', path: 'admin.html#/offerings', users: 'O', reqs: 'SFR-020', detail: true },
  { id: 'UI-A06', name: '회차 등록, 수정', path: 'admin.html#/offerings/new, #/offerings/:id', users: 'O', reqs: 'SFR-020, SER-006', detail: true },
  { id: 'UI-A07', name: '예약 내역', path: 'admin.html#/bookings', users: 'O,F', reqs: 'SFR-021, SER-002, SER-005, SER-006', detail: true },
  { id: 'UI-A08', name: '대기자 관리', path: 'admin.html#/waitlist', users: 'O', reqs: 'SFR-021, SFR-016, SER-005', detail: true },
  { id: 'UI-A09', name: '결제/환불 내역', path: 'admin.html#/payments', users: 'F', reqs: 'SFR-022, SIR-003, SIR-004, SER-006', detail: true },
  { id: 'UI-A10', name: '회차 취소 요청, 승인', path: 'admin.html#/cancel-requests', users: 'O,F', reqs: 'SFR-023, SER-006', detail: true },
  { id: 'UI-A11', name: '정산 현황', path: 'admin.html#/settlement', users: 'F', reqs: 'SFR-024, DAR-003', detail: true },
  { id: 'UI-A12', name: '작업 이력', path: 'admin.html#/audit', users: 'O,F', reqs: 'SER-006', detail: true },
  { id: 'UI-A13', name: '검수용 시계(검수 환경)', path: 'admin.html#/system/clock', users: 'O', reqs: 'SFR-025', detail: true },
  { id: 'UI-A14', name: '시연 데이터 초기화(공개 시연 환경)', path: 'admin.html#/system/reset', users: 'O', reqs: 'SFR-026', detail: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 할인 단계에서 국가유공자 본인, 동반 할인을 고르고 「다음: 결제」로 결제 단계까지 화면 흐름대로 이동
async function pickDiscounts(c) {
  await c.page.evaluate(async () => {
    const set = (s, label) => { const o = [...s.options].find((x) => x.text.startsWith(label)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const sel = [...document.querySelectorAll('main select')];
    set(sel[0], '국가유공자 50'); await new Promise((r) => setTimeout(r, 150));
    set(sel[1], '국가유공자 동반'); await new Promise((r) => setTimeout(r, 300));
  });
}
async function toPay(c, { fill = true } = {}) {
  await c.goto(c.state.discountHash, 1500);
  await pickDiscounts(c);
  await c.page.evaluate(async () => { document.querySelector('.summary [data-next]')?.click(); await new Promise((r) => setTimeout(r, 2500)); });
  if (!fill) return;
  await c.page.evaluate(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('input[name=pm][value=CARD]')?.click(); await s(200);
    const card = document.querySelector('#card'); card.value = card.options[1].value; card.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('main .check.all input')?.click(); await s(300);
  });
}

// 화면별 설계 쪽. capture: 로그인 계정, 화면 높이(h), 이동과 조작(go), 모바일 보조 캡처, 덧붙임 캡처(inset)
// items: 표시 번호 순서. sel 은 CSS 선택자, text 는 그 안에서 글자로 고를 때, pad 는 테두리 여백
export const SCREENS = [
  /* ---------------- 사용자 ---------------- */
  {
    id: 'UI-U01', who: 'guest', h: 1500, mobile: true,
    go: async (c) => { await c.goto('#/'); },
    note: '목록은 유형, 기간, 대상 조건을 주소(#/programs?type=&month=&target=)에 담아 뒤로 가기와 GNB 2depth 링크로 같은 결과를 엽니다.',
    items: [
      { sel: '.site-header .gnb', title: 'GNB(2depth)', desc: '공연(전체, 이번 달, 다음 달), 체험(전체, 가족 체험), 정규 강좌(전체, 수강 신청 안내), 이용 안내(취소/환불 규정, 관람 안내/오시는 길). 버튼을 누르거나 아래 화살표로 열고 Esc 로 닫습니다. 이번 달/다음 달은 서버 기준 시각으로 계산합니다.' },
      { sel: '.site-header .util', title: '회원 메뉴', desc: '비회원은 로그인, 회원 가입. 로그인하면 내 예약, 이름(회원 정보), 로그아웃으로 바뀝니다.' },
      { sel: '.hero-mine', title: '내 예약 확인', desc: '회원은 내 예약 목록으로, 비회원은 로그인 후 내 예약으로 이동합니다.' },
      { sel: '.hero-feature', title: '대표 공연', desc: '판매 중인 공연 하나를 칸 전체 사진 위에 유형, 판매 상태, 제목, 한 줄 소개, 기간과 장소, 시작 가격으로 보입니다. 「예매하기」 옆에 가장 가까운 회차와 잔여석을 보입니다. 자동 넘김은 없습니다.' },
      { sel: '.board-panel', title: '지금 예매할 수 있는 회차', desc: '판매 중, 매진(대기 가능) 회차를 시작 순으로 최대 6건. 상태는 잔여 N석, 「마감 임박 N석」(5석 이하), 「매진, 대기 신청」, 「예매 중」(잔여석 모름). 대표 공연 회차에 「대표 공연」 라벨. 줄을 누르면 상세로 갑니다.' },
      { sel: '.visit-strip', title: '운영 정보', desc: '운영 시간, 휴관일, 현장 매표소, 예약 문의 전화를 첫 화면 아래 한 줄로 보이고 「관람 안내/오시는 길」로 이동합니다.' },
      { sel: '.filters', title: '필터와 건수', desc: '유형, 기간(회차가 있는 달만), 대상. 고르면 목록과 「총 N건」이 바로 바뀌고, 결과가 없으면 안내와 「조건 초기화」를 보입니다.' },
      { sel: '.grid li:first-child .card', title: '프로그램 카드', desc: '3:4 포스터, 유형 라벨, 판매 상태, 기간(2026.12.04 형식), 가격(「40,000원부터」, 「1인 10,000원」). 3열 격자, 860px 이하는 2열입니다.' },
    ],
  },
  {
    id: 'UI-U02', who: 'guest', h: 1320, mobile: true,
    go: async (c) => { await c.goto(`#/programs/${c.ids.chamberProgram}`); },
    note: '불러오기 실패 시 「프로그램 정보를 불러오지 못했습니다.」와 「다시 시도」, 없는 주소는 「프로그램을 찾을 수 없습니다.」와 「프로그램 목록」 버튼을 보입니다. 이용 안내(UI-U18)는 같은 머리말 아래 취소/환불 규정 표, 관람 안내와 오시는 길, 수강 신청 안내를 보입니다.',
    items: [
      { sel: 'nav.crumb', title: '현재 위치', desc: '홈 > 유형 > 프로그램명. 유형을 누르면 그 유형으로 거른 목록으로 갑니다.' },
      { sel: '.detail .d-poster', title: '포스터', desc: '사진 위에 프로그램별 2줄 제목을 얹은 포스터. 넓은 화면에서는 스크롤해도 따라옵니다.' },
      { sel: '.detail .d-tags', title: '유형, 판매 상태', desc: '회차 중 하나라도 판매 중이면 「예매 중」, 모두 매진이면 「매진(대기 가능)」입니다.' },
      { sel: '.detail dl.spec', title: '기본 정보', desc: '기간, 장소(공연은 좌석 수), 대상, 가격(등급별 또는 1인, 수강료), 할인(공연, 체험은 동반 1인 포함, 정규 강좌는 동반 할인 없음, 증빙은 당일 현장 확인), 예매 한도(회차당 1인 4매, 4명, 정규 강좌 1인 1건).' },
      { sel: '.detail .dates', title: '날짜 선택', desc: '회차가 있는 날만 누를 수 있고, 고른 날은 진한 테두리로 표시합니다.' },
      { sel: '.detail .slots', title: '회차 선택', desc: '시각, 회차 순서, 잔여석(잔여 N석, N명)을 보입니다. 매진 회차는 「대기 신청」, 판매 전과 마감 회차는 상태만 보이고 고를 수 없습니다.' },
      { sel: '.detail .cta-row', title: '다음 단계 버튼', desc: '「좌석 선택」(체험 「신청하기」, 강좌 「수강 신청」) 또는 매진 시 「대기 신청」. 비회원은 로그인 화면을 거쳐 같은 회차로 돌아옵니다. 860px 이하에서는 화면 아래 고정 바로 바뀝니다.' },
      { sel: 'nav.tabs', title: '상세 탭', desc: '소개, 프로그램, 출연(강좌는 수업 일정), 취소/환불 규정, 관람 안내로 바로 이동. 취소/환불 규정 표는 가격 기준 환불액(8일 전까지 전액, 7-4일 전 90%, 3-1일 전 70%, 당일 취소 불가)을 계산해 보입니다.' },
    ],
  },
  {
    id: 'UI-U03', who: 'member3@demo.test', h: 960, mobile: true,
    go: async (c) => {
      await c.goto(`#/booking/${c.ids.chamber}/select`);
      await c.page.evaluate(async () => { for (const id of ['86', '87']) { document.querySelector(`[data-seat-id="${id}"]`)?.click(); await new Promise((r) => setTimeout(r, 150)); } });
    },
    note: '768px 이하에서는 44px 체크 행의 「좌석 목록」을 기본 보기로 엽니다(배치도 좌석은 18-22px로 DESIGN.md 허용 예외).',
    items: [
      { sel: '.book-head .bh-title', title: '예매 머리말', desc: '작품명, 일시(2026.12.04(금) 19:30 형식), 장소. 할인, 결제 단계까지 같은 자리에 고정됩니다.' },
      { sel: '.book-head ol.steps', title: '단계 표시', desc: '회차 선택 > 좌석/인원 선택 > 할인 선택 > 결제 > 예매 완료. 현재 단계는 aria-current 로 알립니다.' },
      { sel: '.view-toggle', title: '보기 전환', desc: '「배치도」와 「좌석 목록」(열, 번호, 등급, 가격, 상태 표와 체크 상자)이 같은 선택 상태를 씁니다. 키보드, 화면 낭독기 사용자를 위한 대체 수단입니다(SFR-005).' },
      { sel: '.seat-tools', title: '범례, 잔여석', desc: 'R석, S석, A석, 선택한 좌석, 판매 완료를 색과 글자로 함께 보이고, 「잔여 198석 / 200석」처럼 남은 좌석을 표시합니다.' },
      { sel: '.hall', title: '좌석 배치도', desc: '무대 기준 A-J열 200석(4+12+4 블록). 판매, 선점, 대기 배정 좌석은 누를 수 없습니다. 방향키로 이동, Enter 선택, Space 해제. 한도(회차당 1인 4매, 기존 확정과 선점 합산)를 넘기면 고르지 않고 화면 위 안내 한 곳에 알립니다.' },
      { sel: '.summary .sum-title', title: '선택한 좌석', desc: '「2 / 4매」처럼 선택 수와 남은 한도를 보이고, 좌석 칩(등급, 열, 번호)의 x 로 하나씩 해제합니다.' },
      { sel: '.summary .sum-total', title: '합계', desc: '등급별 매수와 금액, 할인은 다음 단계에서 선택. 금액은 원 단위, 천 단위 쉼표(60,000원)입니다.' },
      { sel: '.summary .btn-primary', title: '다음: 할인 선택', desc: '누르면 좌석을 10분 동안 선점합니다. 그사이 다른 회원이 잡은 좌석이면 「방금 다른 분이 선택한 좌석입니다.」를 알리고 배치도를 새로 그립니다. 처리 중에는 「처리 중」 표시로 중복 요청을 막습니다.' },
    ],
  },
  {
    id: 'UI-U04', who: 'member3@demo.test', h: 700,
    go: async (c) => {
      await c.goto(`#/booking/${c.ids.makeup}/select`);
      await c.page.evaluate(async () => { document.querySelector('main [data-step="1"]')?.click(); await new Promise((r) => setTimeout(r, 200)); });
    },
    note: '정규 강좌는 같은 틀에서 「수강 신청」 제목과 「본인 1명 신청」 고정 표시, 수강료와 잔여 정원을 보이며 인원을 바꿀 수 없습니다.',
    items: [
      { sel: '#sel-title', title: '화면 제목', desc: '체험은 「인원 선택」, 정규 강좌는 「수강 신청」.' },
      { sel: '.qty-row > div:first-child', title: '단가와 잔여', desc: '「1인 10,000원, 잔여 20명」. 선점 실패 뒤에는 잔여 정원을 다시 불러와 바꿉니다.' },
      { sel: '.stepper', title: '인원 조절', desc: '-, + 버튼(44px)과 현재 인원. 최대는 남은 1인 한도(회차당 4명에서 기존 확정, 선점 수를 뺀 값)와 잔여 정원 중 작은 값입니다. 한도에 닿으면 한도 안내를, 정원에 닿으면 「남은 정원보다 많이 선택할 수 없습니다.」를 알립니다.' },
      { sel: '.summary .sum-list', title: '선택 내역', desc: '체험일시, 「2명 (1인 10,000원)」과 금액, 할인은 다음 단계에서 선택.' },
      { sel: '.summary .btn-primary', title: '다음: 할인 선택', desc: '자리를 10분 동안 선점하고 할인 선택으로 이동합니다. 이미 선점한 자리가 있으면 「이어서 진행」과 「선점 해제」를 대신 보입니다.' },
      { sel: '.summary .sum-fine', title: '선점, 한도 안내', desc: '「다음 단계로 넘어가면 자리가 10분 동안 선점됩니다. 회차당 1인 4명까지 신청할 수 있습니다.」' },
    ],
  },
  {
    id: 'UI-U05', who: 'member3@demo.test', h: 690,
    go: async (c) => {
      await c.goto(`#/booking/${c.ids.makeup2}/select`, 1500);
      await c.page.evaluate(async () => { document.querySelector('main [data-step="1"]')?.click(); await new Promise((r) => setTimeout(r, 200)); });
    },
    note: '서버는 같은 회차 중복 신청(「이미 대기 신청한 회차입니다.」), 매진 아님(「아직 좌석이 남아 있어 대기 신청을 할 수 없습니다.」), 정원 초과를 다시 막습니다.',
    items: [
      { sel: '.panel-head .status.wait', title: '매진 표시', desc: '잔여가 0인 판매 중 회차는 선택 화면 대신 같은 주소에서 대기 신청 화면을 엽니다.' },
      { sel: '.qty-row', title: '신청 수량', desc: '공연 「매수」, 체험 「인원」. 「4명까지 신청 가능」은 남은 1인 한도와 회차 정원 중 작은 값입니다. 정규 강좌는 「본인 1명 신청」으로 고정합니다.' },
      { sel: '.wait-rules', title: '대기 신청 안내', desc: '취소분을 신청 순서대로 모아 신청 수량이 모두 모이면 알림, 알림부터 24시간 안에 결제, 기한이 지나면 다음 순번, 공연은 취소된 좌석 그대로 배정, 기준일 2일 전부터 일반 예매 전환과 신청 마감, 예약 한도 동일 적용.' },
      { sel: '.summary .sum-list', title: '신청 내역', desc: '일시, 신청 수량, 결제(배정된 뒤 24시간 안에). 이미 신청했으면 대기 순번과 수량을 보이고 「내 대기 신청 보기」로 바꿉니다.' },
      { sel: '.summary .btn-primary', title: '대기 신청하기', desc: '결제 없이 접수하고 내 대기 신청 목록으로 이동해 순번을 알립니다. 기준일 D-2 이내면 「대기 신청 마감」과 「다른 일정 보기」만 보입니다.' },
    ],
  },
  {
    id: 'UI-U06', who: 'member3@demo.test', h: 780,
    go: async (c) => {
      await c.goto(c.state.discountHash, 1500);
      await pickDiscounts(c);
    },
    note: '선점이 끝난 주소로 들어오면 「선점 시간이 지났습니다.」와 「좌석 다시 선택」, 결제가 끝난 선점이면 「이미 예매가 완료되었습니다.」를 보입니다.',
    items: [
      { sel: '.panel-head .btn-text', title: '좌석 다시 선택', desc: '선택 화면으로 돌아갑니다(선점은 유지되어 「이어서 진행」 또는 「선점 해제」를 고릅니다).' },
      { sel: '.ticket-rows', title: '매수별 할인', desc: '좌석(또는 N번째 인원)마다 일반, 장애인 50%, 장애인 동반 50%, 국가유공자 50%, 국가유공자 동반 50%, 다자녀 30% 중 하나. 정규 강좌는 동반 할인이 없고, 할인을 적용하지 않는 프로그램은 일반만 고릅니다. 할인액은 매수별로 원 미만을 버립니다.' },
      { sel: '.ticket-row:nth-child(2)', title: '검증 규칙', desc: '장애인, 국가유공자 본인 할인은 각 1매까지, 동반 할인은 본인 할인 매수 이하. 어기면 경고와 함께 「다음: 결제」를 막습니다.' },
      { sel: '.note.info', title: '증빙 안내', desc: '「현장에서 증빙을 확인합니다. 증빙이 없으면 차액을 현장에서 결제합니다.」 증빙 파일은 받지 않습니다(SER-004).' },
      { sel: '.summary .timer', title: '남은 선점 시간', desc: 'mm:ss 로 줄어들고, 화면 낭독기에는 분이 바뀔 때만 알립니다. 0이 되면 「선점 시간이 지나 좌석이 해제되었습니다.」와 함께 선택 화면으로 돌아갑니다.' },
      { sel: '.summary [data-summary]', title: '결제 금액', desc: '좌석, 티켓 금액, 할인 유형별 차감, 예매 수수료 0원, 합계. 고를 때마다 바로 다시 계산합니다.' },
      { sel: '.summary [data-next]', title: '다음: 결제', desc: '고른 할인은 결제 단계로 넘기고, 금액은 결제 승인 때 서버가 다시 계산해 대조합니다.' },
    ],
  },
  {
    id: 'UI-U07', who: 'member3@demo.test', h: 1020, mobile: true,
    go: async (c) => {
      await toPay(c);
    },
    mobileGo: async (c) => { await toPay(c, { fill: false }); },
    note: '결제 수단을 고르지 않거나 필수 약관이 빠지면 「결제 수단을 선택해 주세요.」, 「필수 약관에 모두 동의해 주세요.」를 알리고 해당 항목으로 초점을 옮깁니다.',
    items: [
      { sel: '.methods', title: '결제 수단', desc: '신용/체크카드, 계좌이체, 간편결제 중 하나(라디오 그룹). 고른 수단은 테두리로 표시합니다.' },
      { sel: '.card-fields', title: '카드사, 할부', desc: '카드 선택 시에만 보입니다. 카드사를 고르지 않으면 칸 아래 「카드사를 선택해 주세요.」를 보이고 초점을 옮깁니다.' },
      { sel: '.agree .check.all', title: '전체 동의', desc: '필수 3개(예매 및 취소 수수료 규정, 개인정보 제3자 제공(결제대행), 결제대행 서비스 이용약관)를 한 번에 고릅니다. 각 항목의 「보기」는 약관 대화상자를 엽니다.' },
      { sel: '.summary .sum-total', title: '최종 결제 금액', desc: '할인 단계에서 고른 금액. 승인 때 서버가 선점 유효성과 금액을 다시 계산해 다르면 결제를 즉시 취소합니다(SFR-011, SER-007).' },
      { sel: '.summary .sum-cancel', title: '취소 수수료 일정', desc: '관람일 기준 실제 날짜로 「무료 취소 2026.11.26(목)까지」, 수수료 10%, 30% 기간, 당일 취소 불가를 보입니다.' },
      { sel: '.summary [data-pay]', title: '결제하기', desc: '「30,000원 결제하기」. 모든 조건을 채워야 활성화됩니다. 결제 단계는 결제대행 결제창 자리이며, 프로토타입은 모의 어댑터로 승인합니다.' },
    ],
  },
  {
    id: 'UI-U08', who: 'member3@demo.test', h: 760,
    go: async (c) => {
      await toPay(c);
      await c.page.evaluate(async () => { document.querySelector('.summary [data-pay]')?.click(); await new Promise((r) => setTimeout(r, 4500)); });
      c.state.paidNo = await c.page.evaluate(() => document.querySelector('main').innerText.match(/B\d{8}/)?.[0] ?? null);
      await c.page.evaluate(() => window.scrollTo(0, 0));
    },
    note: '실패 결과(#/payment/fail)는 「결제가 완료되지 않았습니다.」와 사유, 「선점은 남은 시간 동안 유지됩니다.」 안내, 「할인 선택으로 돌아가기」를 보입니다. 승인 후 재검증 실패는 「승인된 결제는 자동으로 취소되었습니다.」를 덧붙입니다.',
    items: [
      { sel: 'main h1', title: '결과 제목', desc: '승인 성공 시 「예매가 완료되었습니다.」. 같은 주문은 다시 그려도 승인 요청을 한 번만 보냅니다(서버도 멱등).' },
      { sel: 'main dl', title: '예약 요약', desc: '예약번호(B+8자리), 프로그램, 일시, 장소, 좌석(R석 E열 6번 형식) 또는 인원, 할인, 결제 금액.' },
      { sel: 'main dl + p, main .result-note', title: '안내 문구', desc: '할인을 고른 경우 「할인 증빙은 방문 당일 현장에서 확인합니다.」, 아니면 내 예약 안내.' },
      { sel: 'main .btn-primary', title: '내 예약 보기', desc: '내 예약 목록으로 이동합니다. 옆의 「다른 공연, 강좌 찾기」는 목록으로 갑니다.' },
    ],
  },
  {
    id: 'UI-U10', who: 'member3@demo.test', h: 980,
    go: async (c) => { await c.goto('#/me/bookings', 1500); },
    note: '탭별 빈 상태: 「예정된 예약이 없습니다.」, 「지난 예약이 없습니다.」, 「취소한 예약이 없습니다.」. 불러오기 실패 시 「내용을 불러오지 못했습니다.」와 「다시 불러오기」.',
    items: [
      { sel: 'nav.side-nav', title: '마이페이지 메뉴', desc: '예약 내역(예정 건수), 대기 신청(진행 중 건수), 알림(안 읽은 건수), 회원 정보. 860px 이하에서는 밑줄 탭으로 바뀝니다.' },
      { sel: '.promo-card, [aria-label="대기 승격 안내"]', title: '대기 승격 안내', desc: '승격된 대기가 있으면 맨 위에 「대기하신 「프로그램」 자리가 배정되었습니다」, 배정 수량, 결제 기한(「월.일(요일) 시:분까지」 형식)과 「결제하기」를 보입니다.' },
      { sel: 'nav.sub-tabs', title: '상태 탭', desc: '예정, 지난 예약, 취소와 각 건수. 예정은 가까운 일정 순, 나머지는 최근 예약 순입니다.' },
      { sel: 'article.bk', title: '예약 카드', desc: '포스터, 유형, 상태(예매 완료, 예약 완료, 수강 확정 / 관람 완료 / 예약 취소), 제목, 일시, 좌석 또는 인원, 할인, 장소.' },
      { sel: 'article.bk .bk-side', title: '예약번호, 금액', desc: '예약번호를 누르면 예약 상세로 이동하고, 「상세 보기」는 카드 안에서 결제 정보와 환불 미리보기, 예약 취소를 펼칩니다.' },
    ],
  },
  {
    id: 'UI-U11', who: 'member3@demo.test', h: 900,
    go: async (c) => {
      await c.goto('#/me/bookings', 1200);
      const href = await c.page.evaluate((no) => [...document.querySelectorAll('a')].find((a) => a.textContent.includes(no))?.getAttribute('href'), c.state.potteryNo);
      await c.goto(href.replace(/^.*?#/, '#'), 1500);
    },
    inset: {
      label: '예약 취소 확인 대화상자',
      go: async (c) => {
        await c.page.evaluate(async () => { [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '예약 취소')?.click(); await new Promise((r) => setTimeout(r, 1500)); });
      },
      sel: '[role=dialog]',
      after: async (c) => { await c.page.keyboard.press('Escape'); },
    },
    note: '당일(D-0)은 「관람(개강) 당일에는 취소할 수 없습니다.」와 함께 취소 버튼을 두지 않고, 끝난 예약은 「이미 끝난 예약은 취소할 수 없습니다.」를 보입니다.',
    items: [
      { sel: 'main .back-link', title: '예약 내역으로', desc: '목록으로 돌아갑니다.' },
      { sel: 'article.bk .bk-info', title: '예약 내용', desc: '유형, 상태, 제목, 일시, 인원 또는 좌석, 할인(별도 줄), 장소.' },
      { sel: 'article.bk .bk-pay, article.bk h4', title: '결제 정보', desc: '결제일시, 결제 금액, 결제 수단(모의 결제), 할인 증빙(방문 당일 현장에서 확인).' },
      { sel: '.refund-box, .refund', title: '환불 미리보기', desc: '서버와 같은 정책 코드로 지금 취소하면 받을 금액을 계산합니다. 8일 전까지 전액, 7-4일 전 90%, 3-1일 전 70%, 정규 강좌 개강 후 1/3 경과 전 2/3, 1/2 경과 전 1/2, 이후 환불 없음. 환불액은 원 미만 버림, 수수료는 결제액 - 환불액. D-day 는 한국 시간 달력 날짜로 셉니다.' },
      { sel: 'main button', text: '예약 취소', title: '예약 취소', desc: '서버 시각을 다시 맞춰 금액을 새로 계산한 뒤 확인 대화상자를 엽니다. 「예약 취소하기」를 누르면 예약 전체를 취소하고 「예약이 취소되었습니다. 21,600원이 결제 수단으로 환불됩니다(취소 수수료 2,400원).」처럼 알립니다. 중복 요청은 막습니다.' },
    ],
  },
  {
    id: 'UI-U12', who: 'member3@demo.test', h: 560,
    go: async (c) => { await c.goto('#/me/waitlist', 1500); },
    note: '내역이 없으면 「대기 신청한 내역이 없습니다.」와 「예매할 공연, 강좌 찾기」를 보입니다.',
    items: [
      { sel: '.my-intro', title: '안내', desc: '「매진된 회차에 대기 신청을 하면, 자리가 나는 순서대로 24시간 안에 결제할 수 있는 기회를 드립니다.」' },
      { sel: '.wl', title: '대기 카드', desc: '유형, 상태(결제 가능, 대기 중), 제목, 일시, 순번(N번째), 신청 수량, 배정 수량. 결제 가능한 건을 위에 둡니다.' },
      { sel: '.wl-deadline', title: '결제 기한', desc: '승격된 건은 「결제 기한: 월.일(요일) 시:분까지」로 보입니다. 승격 시각부터 24시간이며 지나면 다음 순번으로 넘어갑니다. D-2 안으로 넘어간 만료분은 일반 판매로 풉니다.' },
      { sel: '.wl .btn-primary', title: '결제하기', desc: '배정된 자리(공연은 취소된 좌석 그대로)로 선점을 만들고 할인 선택 단계로 이동합니다. 남은 선점 시간은 「23시간 59분」처럼 보입니다.' },
      { sel: '.wl button', text: '대기 취소', title: '대기 취소', desc: '확인 대화상자 후 취소합니다. 승격된 건은 「배정된 자리도 함께 다음 대기자에게 넘어갑니다.」, 대기 중인 건은 순번이 사라진다는 안내를 보입니다.' },
    ],
  },
  {
    id: 'UI-U13', who: 'member3@demo.test', h: 640,
    go: async (c) => { await c.goto('#/me/notifications', 1500); },
    note: '알림이 없으면 「받은 알림이 없습니다.」와 「예매할 공연, 강좌 찾기」를 보입니다.',
    items: [
      { sel: '.my-head .btn-secondary', title: '모두 읽음 처리', desc: '안 읽은 알림이 있을 때만 보입니다. 처리 후 메뉴의 안 읽은 건수가 함께 줄어듭니다.' },
      { sel: '.noti-list li:first-child .noti-top', title: '알림 머리', desc: '안 읽음 표시, 발송 채널(문자(모의)), 발송 일시(2026.11.24(화) 12:04 형식).' },
      { sel: '.noti-list li:nth-child(2) .noti-text', title: '알림 내용', desc: '결제 완료, 취소, 환불, 대기 승격, 결제 기한 만료, 회차 취소 알림. 문자, 알림톡 발송 자리에 남기는 발송 기록과 같은 내용입니다(SFR-017).' },
      { sel: '.noti-list li:first-child button', title: '읽음 처리', desc: '한 건씩 읽음으로 바꿉니다. 화면 낭독기에는 「(알림 제목) 읽음 처리」로 읽힙니다.' },
    ],
  },
  {
    id: 'UI-U14', who: 'member3@demo.test', h: 1240,
    go: async (c) => { await c.goto('#/account', 1500); },
    note: '공개 시연 환경에서 README 에 공개된 시연 계정은 연락처 수정, 탈퇴가 막히고 비밀번호 변경 칸을 감춥니다(「시연용 계정은 변경할 수 없습니다.」).',
    items: [
      { sel: 'dl.profile-list', title: '회원 정보', desc: '이메일, 연락처 입력 완료일(2026.11.24(화) 형식). 이메일은 로그인 아이디라 바꿀 수 없다는 안내를 붙입니다. 수집 항목은 이메일, 이름, 휴대폰 번호뿐입니다(SER-004).' },
      { sel: '#contact-form', title: '연락처 수정', desc: '이름(50자까지), 휴대폰 번호(010으로 시작하는 숫자 10-11자리, 하이픈 자동 정리). 오류는 칸 아래에, 성공은 「회원 정보를 수정했습니다.」로 알립니다.' },
      { sel: '#pw-form', title: '비밀번호 변경', desc: '영문과 숫자를 함께 8자 이상(SER-001). 성공 시 「비밀번호를 변경했습니다.」.' },
      { sel: '.account-actions', title: '로그아웃, 회원 탈퇴', desc: '탈퇴는 확인 단계에서 「진행 중인 예약이 있으면 탈퇴할 수 없습니다.」를 안내하고, 서버가 진행 중 예약을 확인해 막습니다. 탈퇴하면 이름과 휴대폰 번호를 바로 지웁니다.' },
    ],
  },
  {
    id: 'UI-U15', who: 'guest', h: 760,
    go: async (c) => { await c.goto('#/signup', 1200); },
    note: '비밀번호 재설정(#/reset)은 가입한 이메일로 링크를 보내고, 링크로 들어오면 회원 정보에서 새 비밀번호를 정합니다.',
    items: [
      { sel: 'ol.steps', title: '가입 단계', desc: '계정 정보 > 약관 동의 > 연락처 입력. 3단계는 이름과 휴대폰 번호 입력만 받으므로 본인 인증처럼 보이는 문구를 쓰지 않습니다(SIR-006 모의 대체).' },
      { sel: 'main form .field', title: '이메일', desc: '형식이 틀리면 「이메일 주소 형식이 올바르지 않습니다. 예: name@example.com 형식으로 입력해 주세요.」' },
      { sel: '#password-hint', title: '비밀번호 규칙', desc: '영문과 숫자를 함께 8자 이상. 확인 칸과 다르면 「비밀번호가 서로 다릅니다.」' },
      { sel: 'main form button[type=submit]', title: '다음', desc: '검사를 통과하면 약관 동의로 이동합니다. 약관 단계는 [필수] 이용약관, [필수] 개인정보 수집과 이용, [선택] 소식 수신과 전체 동의, 「보기」 대화상자를 두며 필수를 모두 골라야 「다음」이 켜집니다.' },
      { sel: '.auth-alt', title: '로그인 링크', desc: '이미 회원이면 로그인으로 이동합니다. 로그인은 실패를 반복하면 인증 서비스가 지연시키고, 연락처 입력을 마치지 못한 계정은 그 단계로 보냅니다.' },
    ],
  },

  /* ---------------- 관리자 ---------------- */
  {
    id: 'UI-A02', who: 'operator@demo.test', admin: true, h: 900,
    go: async (c) => { await c.goto('#/', 1800); },
    note: '정산 담당은 같은 자리에 오늘 결제액, 오늘 환불액, 오늘 확정 예약, 회차 취소 승인 대기를 보입니다. 관리자 로그인(UI-A01)은 이메일, 비밀번호와 「사용자 화면으로 이동」을 두고, 담당자가 아닌 계정은 「접근 권한이 없습니다」와 「다른 계정으로 로그인」을 보입니다.',
    items: [
      { sel: '.topbar .brand', title: '기관명', desc: '한빛아트센터 통합 예약 관리. 누르면 대시보드로 갑니다.' },
      { sel: '.topbar .t-search', title: '통합 검색', desc: '운영 담당만 보입니다. 프로그램명을 넣으면 프로그램 목록을 그 이름으로 거릅니다.' },
      { sel: '.topbar .session', title: '자동 로그아웃', desc: '마지막 화면 이동이나 「연장」 뒤 30분이 지나면 로그아웃합니다. 1분 남으면 강조하고 화면 낭독기에 알립니다.' },
      { sel: '.topbar .who', title: '담당자, 역할', desc: '역할 칩(운영 담당, 정산 담당)과 이름, 「로그아웃」.' },
      { sel: 'nav.sidebar', title: '좌측 메뉴 트리', desc: '대시보드, 프로그램관리, 예약관리, 결제/정산, 시스템 5묶음을 접고 폅니다. 역할과 환경에 맞는 메뉴만 보이고, 주소로 직접 들어와도 「이 메뉴를 쓸 권한이 없습니다」로 막습니다(데이터는 행 단위 접근 정책이 다시 막음). 대기자, 취소 요청 건수를 메뉴 옆에 표시합니다.' },
      { sel: '.kpis', title: '주요 수치', desc: '판매 중인 회차(시작 전 회차 기준), 오늘 확정 예약, 대기 신청(대기 중과 승격 포함), 회차 취소 요청(정산 담당 승인 대기). 한 장의 목록으로 한 줄에 이름, 값, 설명, 바로가기 링크를 둡니다.' },
      { sel: '.content .result, .content section:last-of-type', title: '다가오는 회차', desc: '오늘부터 14일 안의 회차 일시(12.04(금) 19:30 형식), 유형, 프로그램, 정원, 판매/선점, 잔여. 없으면 「14일 안에 시작하는 회차가 없습니다.」' },
    ],
  },
  {
    id: 'UI-A03', who: 'operator@demo.test', admin: true, h: 900,
    go: async (c) => { await c.goto('#/programs', 1800); },
    note: '프로그램 등록, 수정 화면은 기본 정보(유형, 프로그램명 100자, 한 줄 소개, 상세 설명, 장소, 대상, 공개 여부, 할인 적용, 취소 규정 표시)와 포스터(사진, 글자 색, 시리즈명, 제목, 부제), 회차 목록으로 이루어집니다. 회차가 있으면 유형을 바꿀 수 없습니다.',
    items: [
      { sel: '.page-head .crumb', title: '경로, 제목, 도움말', desc: '홈 > 프로그램관리 > 프로그램 목록. 오른쪽 도움말은 「비공개 프로그램은 사용자 화면에 보이지 않습니다.」' },
      { sel: 'form.search-box', title: '조회 조건', desc: '유형, 공개 여부, 프로그램명. 「초기화」와 「조회」. 상단 통합 검색으로 들어오면 프로그램명이 채워집니다.' },
      { sel: '.toolbar .total', title: '건수', desc: '「총 6건」. 화면 낭독기에 바뀐 건수를 알립니다.' },
      { sel: '.toolbar [data-act="csv"]', title: 'CSV 다운로드', desc: '조회 결과를 「프로그램목록_20261124.csv」로 내려받습니다(UTF-8 BOM, 수식 주입 방지). 0건이면 「내려받을 내역이 없습니다.」를 알립니다.' },
      { sel: '.toolbar .btn-primary', title: '프로그램 등록', desc: '등록 화면으로 이동합니다. 저장 후 회차 등록을 이어서 안내합니다.' },
      { sel: 'table.grid-table', title: '목록 표', desc: '번호, 유형 칩, 프로그램명(누르면 수정), 장소, 회차 수, 공개 여부 칩, 등록일(2026.11.24(화)). 숫자는 오른쪽 정렬, 20건씩(50건 선택) 나눕니다.' },
    ],
  },
  {
    id: 'UI-A05', who: 'operator@demo.test', admin: true, h: 1120,
    go: async (c) => { await c.goto('#/offerings', 1800); },
    note: '판매, 선점, 대기 수량은 지금 기준입니다. 결제 진행 중인 수량은 선점에 포함합니다.',
    items: [
      { sel: 'form.search-box', title: '조회 조건', desc: '회차 기간, 프로그램, 유형, 상태(판매 중, 판매 전, 판매 종료, 취소 요청, 회차 취소).' },
      { sel: '.toolbar', title: '건수, 내려받기, 등록', desc: '총 건수, CSV 다운로드(회차목록_날짜.csv), 페이지당 건수, 「회차 등록」.' },
      { sel: 'table.grid-table thead', title: '목록 열', desc: '번호, 유형, 프로그램, 회차 일시(누르면 수정과 좌석 현황), 판매 기간(11.17(화) 00:00 - 12.04(금) 19:30), 정원, 판매, 선점, 대기, 잔여, 상태.' },
      { sel: 'table.grid-table tbody tr:last-child td:last-child', title: '상태 칩', desc: '판매 전, 판매 중, 판매 종료, 취소 요청, 회차 취소를 글자와 색으로 함께 보입니다. 판단은 서버가 다시 합니다.' },
    ],
  },
  {
    id: 'UI-A06', who: 'operator@demo.test', admin: true, h: 1320,
    go: async (c) => {
      await c.goto(`#/offerings/new?program=${c.ids.chamberProgram}`, 1800);
      await c.page.evaluate(async () => {
        const set = (id, v) => { const e = document.querySelector(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('#f-starts_at', '2026-12-20T19:30'); set('#f-ends_at', '2026-12-20T21:00');
        set('#f-sale_starts_at', '2026-11-25T10:00'); set('#f-sale_ends_at', '2026-12-20T18:00');
        set('#f-price_R', '40000'); set('#f-price_S', '30000'); set('#f-price_A', '20000');
        await new Promise((r) => setTimeout(r, 300));
      });
    },
    note: '수정 화면은 같은 양식 아래 좌석 현황(등급별 판매 가능, 선점, 대기 배정, 판매 수와 축소 배치도)을 보이고, 취소되었거나 취소 요청 중인 회차는 고칠 수 없습니다.',
    items: [
      { sel: '[data-field="program_id"], #f-program_id', title: '프로그램', desc: '먼저 등록한 프로그램을 고릅니다. 등록 후에는 바꿀 수 없습니다. 유형에 따라 정원, 가격, 수업 횟수 칸이 바뀝니다.' },
      { sel: '#f-starts_at', title: '시작, 종료 일시', desc: '한국 시간 입력, 저장은 UTC. 지난 일시로 등록할 수 없고 종료는 시작보다 늦어야 합니다. 정규 강좌는 첫 수업 시작과 마지막 수업 종료입니다.' },
      { sel: '#f-sale_starts_at', title: '판매 기간', desc: '판매 종료는 판매 시작보다 늦고 회차 시작 전에 끝나야 합니다.' },
      { sel: '#f-capacity, [data-field="capacity"]', title: '정원', desc: '공연은 좌석 수(200석)로 정해집니다. 체험, 강좌는 1-10,000명이며 판매, 선점, 대기 배정된 수보다 작게 줄일 수 없습니다.' },
      { sel: '.price-grid', title: '가격', desc: '공연은 R석(A-D열 80석), S석(E-G열 60석), A석(H-J열 60석) 가격, 그 밖은 1인 가격. 1원 이상(무료 회차 불가), 1,000원 단위 입력. 바꿔도 이미 확정된 예약 금액은 그대로입니다.' },
      { sel: '.save-bar', title: '저장', desc: '「목록」과 「저장」. 저장하면 사용자 화면에 바로 반영되고 회차 등록, 수정, 가격 설정이 작업 이력에 남습니다(SER-006).' },
    ],
  },
  {
    id: 'UI-A07', who: 'operator@demo.test', admin: true, h: 1100,
    go: async (c) => { await c.goto('#/bookings', 1800); },
    note: '예약번호를 누르면 이름, 휴대폰, 이메일 전체를 보이는 예약 상세 대화상자를 열고 「이 열람은 작업 이력에 기록되었습니다.」를 표시합니다(SER-005, SER-006).',
    items: [
      { sel: 'form.search-box', title: '조회 조건', desc: '예약일(오늘, 7일, 1개월, 3개월 빠른 기간, 기본 7일), 유형, 프로그램, 회차, 예약 상태(확정 기본 선택, 취소), 할인 유형, 검색어(예약자명, 예약번호, 휴대폰 뒤 4자리).' },
      { sel: '.toolbar .total', title: '건수', desc: '「총 8건 (확정 8, 취소 0)」처럼 상태별 건수를 함께 보입니다.' },
      { sel: '.toolbar [data-act="proof"]', title: '증빙 확인 처리', desc: '운영 담당만 보입니다. 선택한 확정 예약의 증빙 확인 전 할인 매수를 현장 확인 완료로 기록합니다(파일은 받지 않음).' },
      { sel: 'table.grid-table thead th:first-child', title: '선택', desc: '쪽 전체 선택과 행 선택 체크 상자.' },
      { sel: 'table.grid-table tbody tr:first-child td:nth-child(3)', title: '예약번호', desc: '누르면 예약 상세(개인정보 전체)를 엽니다.' },
      { sel: 'table.grid-table thead', title: '목록 열', desc: '유형, 프로그램, 회차, 좌석/인원, 예약자(김*수), 연락처(010-****-1234), 할인, 결제 금액(오른쪽 정렬), 상태(확정, 취소), 증빙(확인 전, 확인 완료), 예약 일시.', offset: [520, 0] },
    ],
  },
  {
    id: 'UI-A08', who: 'operator@demo.test', admin: true, h: 700,
    go: async (c) => { await c.goto('#/waitlist', 1800); },
    note: '승격은 회원의 취소 처리 안에서 자동으로 일어나며, 기한 만료와 다음 순번 승격은 1분마다 도는 DB 예약 작업과 조회 화면이 처리합니다.',
    items: [
      { sel: '.page-head .help', title: '규칙 안내', desc: '「순번은 회차별 진행 중 신청의 순서입니다. 취소분이 1순위 신청 수량만큼 모이면 자동으로 승격되고 24시간 안에 결제해야 합니다.」' },
      { sel: 'form.search-box', title: '조회 조건', desc: '유형, 프로그램, 상태(진행 중(대기, 승격) 기본, 전체, 대기 중, 승격(결제 대기), 종료).' },
      { sel: 'table.grid-table thead', title: '목록 열', desc: '순번, 유형, 프로그램, 회차, 신청자, 연락처(가림), 신청 수량, 배정 수량, 상태, 신청 일시, 결제 기한(승격 건만).' },
      { sel: 'table.grid-table tbody tr:first-child td:nth-child(9)', title: '상태 칩', desc: '대기 중, 승격(결제 대기), 예매 완료, 기한 만료, 신청 취소, 대기 종료(D-2 일반 판매 전환).' },
      { sel: '.toolbar [data-act="csv"]', title: 'CSV 다운로드', desc: '대기자목록_날짜.csv. 개인정보는 가린 값 그대로 내려받습니다.' },
    ],
  },
  {
    id: 'UI-A09', who: 'finance@demo.test', admin: true, h: 980,
    go: async (c) => { await c.goto('#/payments', 1800); },
    note: '결제대행 웹훅은 중복으로 받아도 한 번만 반영하고(SIR-004), 원본 열람은 작업 이력에 남습니다.',
    items: [
      { sel: '.toolbar .seg', title: '내역 종류', desc: '결제 내역과 환불 내역 전환. 조회 조건의 기간 이름도 승인일, 환불일로 바뀝니다.' },
      { sel: 'form.search-box', title: '조회 조건', desc: '승인일(기본 이번 달), 프로그램, 결제 상태(결제 완료, 부분 취소, 전체 취소) 또는 환불 사유(회원 취소, 기관 취소, 결제 충돌).' },
      { sel: '.toolbar .total', title: '건수, 합계', desc: '「총 11건 (결제 합계 664,000원)」처럼 조회 결과의 합계를 함께 보입니다.' },
      { sel: 'table.grid-table thead', title: '결제 내역 열', desc: '승인 일시, 결제대행 거래 번호, 예약번호, 프로그램, 결제자(가림), 결제 금액, 환불 금액, 상태, 원본. 환불 내역은 취소 거래 번호, 원 결제 거래 번호, 취소 수수료, 사유, 적용 규정(7 - 4일 전(수수료 10%) 등)을 보입니다.' },
      { sel: 'table.grid-table tbody tr:first-child td:last-child', title: '원본', desc: '결제 승인 원본(주문번호, 결제대행 응답)을 대화상자로 보입니다.' },
    ],
  },
  {
    id: 'UI-A10', who: 'finance@demo.test', admin: true, h: 820,
    go: async (c) => {
      await c.goto('#/cancel-requests', 1800);
      await c.page.evaluate(() => { document.querySelectorAll('.table-scroll').forEach((t) => { t.scrollLeft = t.scrollWidth; }); });
    },
    note: '목록 표는 열이 많아 가로로 밀어 봅니다(캡처는 오른쪽 끝). 운영 담당 화면은 위쪽에 회차 취소 요청 양식(판매 중 회차 선택, 취소 사유 500자)을 두고, 요청하면 정산 담당 결정 전까지 그 회차의 새 예매와 결제가 막힙니다.',
    items: [
      { sel: '.page-head .help', title: '안내', desc: '「승인하면 회차를 취소하고 확정 예약 전부를 결제 금액 그대로 환불합니다. 대상자에게는 알림이 갑니다.」' },
      { sel: '.content .table-scroll', title: '요청 목록 열', desc: '요청 일시, 유형, 프로그램, 회차, 사유, 요청자, 남은 확정 예약, 환불 예정 금액, 기관 환불 건수, 상태(승인 대기, 반려, 환불 진행 중, 환불 완료).' },
      { sel: 'table.grid-table button', text: '승인', title: '승인', desc: '확정 예약 수와 환불 금액, 사유, 요청자를 확인 대화상자로 보이고 「승인하고 환불」을 누르면 회차를 취소하고 전액 일괄 환불합니다. 일부 실패하면 건수와 「환불 다시 실행」을 안내합니다.' },
      { sel: 'table.grid-table button', text: '반려', title: '반려', desc: '확인 후 반려하면 회차가 다시 판매 중이 됩니다.' },
      { sel: 'table.grid-table tbody tr:last-child td:nth-child(10)', title: '처리 결과', desc: '승인된 건은 「환불 완료」, 환불이 남으면 「환불 진행 중」과 「환불 다시 실행」. 요청, 승인, 반려는 작업 이력에 남습니다.' },
    ],
  },
  {
    id: 'UI-A11', who: 'finance@demo.test', admin: true, h: 1240,
    go: async (c) => {
      await c.goto('#/settlement', 1800);
      await c.page.evaluate(async () => {
        const d = [...document.querySelectorAll('main input[type=date]')];
        const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        const to = d[1].value; const t = new Date(`${to}T00:00:00`); t.setDate(t.getDate() - 6);
        set(d[0], `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
        [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === '조회')?.click();
        await new Promise((r) => setTimeout(r, 1800));
      });
    },
    note: '기간이 비었거나 거꾸로면 「조회할 기간의 시작일과 종료일을 모두 입력해 주세요.」, 「시작일이 종료일보다 늦습니다.」, 1년(366일)을 넘으면 「기간은 1년(366일) 안으로 선택해 주세요.」',
    items: [
      { sel: 'form.filter-bar', title: '정산 조건', desc: '기간(기본 이번 달 1일 - 오늘), 프로그램, 집계(일별, 프로그램별), 「조회」, 「CSV 다운로드」(정산현황_일별_20261118-20261124.csv, 합계 행 포함).' },
      { sel: '.kpi-host', title: '기간 합계', desc: '결제 금액(승인 완료 기준, 건수), 환불 금액(회원 취소, 기관 취소 건수), 취소 수수료 수입(결제 금액에 포함), 순매출(결제 금액 - 환불 금액). 한 장의 목록이고 순매출은 위 굵은 선으로 구분한 합계 줄입니다.' },
      { sel: '.chart', title: '일별 순매출', desc: '막대 그래프와 일평균, 최고, 최저(12.01 형식). 그래프에는 같은 내용을 글로 담은 대체 설명을 둡니다.' },
      { sel: '.content .card:nth-of-type(2), .two-col > :last-child', title: '프로그램별 순매출', desc: '기간 합계를 프로그램별 비중 막대로 보입니다.' },
      { sel: 'section.result table, table.grid-table', title: '정산표', desc: '일자 또는 프로그램, 결제 건수, 결제 금액, 환불 건수, 환불 금액, 취소 수수료, 순매출과 합계 행. 금액은 원 단위 정수, 결제는 승인일, 환불은 환불일(한국 시간) 기준입니다.' },
    ],
  },
  {
    id: 'UI-A12', who: 'operator@demo.test', admin: true, h: 900,
    go: async (c) => { await c.goto('#/audit', 1800); },
    note: '작업 이력은 화면에서 지우거나 고칠 수 없고, 최신순 최대 1,000건까지 보입니다.',
    items: [
      { sel: 'form.search-box', title: '조회 조건', desc: '기간(빠른 기간 포함), 작업자, 작업 종류.' },
      { sel: 'table.grid-table thead', title: '목록 열', desc: '작업 일시, 작업자(가린 이름과 역할), 작업 종류, 대상, 상세.' },
      { sel: 'table.grid-table tbody tr:first-child td:nth-child(3)', title: '작업 종류', desc: '프로그램 등록, 수정, 회차 등록, 수정, 가격 설정, 증빙 확인, 개인정보 열람, 결제 원본 열람, 회차 취소 요청, 승인, 반려, 처리, 검수용 시계 변경, 시연 데이터 초기화.' },
      { sel: '.audit-detail summary', title: '상세 보기', desc: '바뀐 값(이전, 이후)을 펼쳐 봅니다.' },
    ],
  },
  {
    id: 'UI-A13', who: 'operator@demo.test', admin: true, h: 760,
    go: async (c) => { await c.goto('#/system/clock', 1800); },
    inset: {
      label: 'UI-A14 시연 데이터 초기화',
      go: async (c) => { await c.goto('#/system/reset', 1800); },
      sel: '.content',
      maxH: 300,
    },
    note: '두 화면 모두 운영 담당 전용입니다. 검수용 시계는 검수, 로컬 환경에서만, 시연 데이터 초기화는 공개 시연, 로컬 환경에서만 메뉴에 보이며, 주소로 들어와도 「이 환경에서는 쓸 수 없는 메뉴입니다」로 막습니다.',
    items: [
      { sel: '.page-head .help', title: '안내', desc: '켜면 선점 만료, 대기 승격 기한, 환불 기준일이 아래 기준 시각으로 판단됩니다. 공개 시연 빌드에서는 메뉴가 없고 DB 함수도 오프셋을 무시합니다(SFR-025).' },
      { sel: '.clock-now', title: '현재 기준 시각', desc: '「실제보다 1일 앞입니다.」처럼 실제 시각과의 차이를 함께 보입니다.' },
      { sel: '.sys-actions', title: '시계 조정', desc: '+10분, +1일, +7일 등으로 앞당기고 「초기화」로 실제 시각으로 되돌립니다. 켜져 있으면 모든 관리자 화면 위에 띠로 알리고, 변경은 작업 이력에 남습니다.' },
      { sel: '.sidebar a[href="#/system/reset"]', title: '시연 데이터 초기화(UI-A14)', desc: '예약, 결제와 환불 기록, 대기, 알림, 작업 이력을 지우고 프로그램과 회차 일정을 지금 시각 기준으로 다시 만듭니다. 담당자와 회원 계정은 유지됩니다. 확인 대화상자(되돌릴 수 없음) 후 실행하고 실행 이력을 남깁니다(SFR-026).' },
    ],
  },
];
