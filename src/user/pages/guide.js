// 이용 안내: 취소/환불 규정, 관람 안내/오시는 길, 수강 신청 안내. 정책 값은 요구사항 정책 요약과 같습니다.
import { escapeHtml } from '../../lib/format.js';

const PAGES = [
  ['refund', '취소/환불 규정'],
  ['visit', '관람 안내/오시는 길'],
  ['course', '수강 신청 안내'],
];

function table(caption, head, rows, numCols = []) {
  const th = head.map((h, i) => `<th scope="col"${numCols.includes(i) ? ' class="r"' : ''}>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => (i === 0
    ? `<th scope="row">${escapeHtml(c)}</th>`
    : `<td${numCols.includes(i) ? ' class="r"' : ''}>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('');
  return `<div class="tbl-scroll"><table class="tbl"><caption class="sr-only">${escapeHtml(caption)}</caption><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function shell(active, title, lead, body) {
  const nav = PAGES.map(([key, label]) => `<a href="#/guide/${key}"${key === active ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join('');
  return `<div class="container guide">
    <nav class="crumb" aria-label="현재 위치"><ol><li><a href="#/">홈</a></li><li>이용 안내</li><li aria-current="page">${escapeHtml(title)}</li></ol></nav>
    <h1 class="page-title">${escapeHtml(title)}</h1>
    <p class="guide-lead">${escapeHtml(lead)}</p>
    <nav class="sub-tabs guide-tabs" aria-label="이용 안내">${nav}</nav>
    <div class="guide-body">${body}</div>
  </div>`;
}

export function renderGuideRefund(el) {
  el.innerHTML = shell('refund', '취소/환불 규정', '취소 수수료는 관람일, 체험일, 개강일을 기준일로 한국 시간 달력 날짜에 따라 정합니다. 예약 취소는 예약 내역에서 직접 하실 수 있고, 환불액은 결제하신 수단으로 돌아갑니다.', `
    <section class="guide-sec" aria-labelledby="g-before">
      <h2 id="g-before">공연, 체험, 정규 강좌(개강 전)</h2>
      ${table('공연, 체험, 정규 강좌 개강 전 취소 수수료', ['취소 시점', '취소 수수료', '환불액'], [
        ['기준일 8일 전까지', '없음', '결제액 전액'],
        ['기준일 7일 전 - 4일 전', '결제액의 10%', '결제액의 90%'],
        ['기준일 3일 전 - 1일 전', '결제액의 30%', '결제액의 70%'],
        ['기준일 당일 이후', '-', '취소할 수 없습니다'],
      ])}
      <p class="fine">예: 12월 12일 공연은 12월 4일까지 수수료 없이 취소할 수 있고, 12월 12일 당일에는 취소할 수 없습니다.</p>
    </section>
    <section class="guide-sec" aria-labelledby="g-course">
      <h2 id="g-course">정규 강좌(개강 후 중도 취소)</h2>
      ${table('정규 강좌 개강 후 환불액', ['경과 시점(총 회차 대비)', '환불액'], [
        ['1/3 경과 전', '결제액의 2/3'],
        ['1/2 경과 전', '결제액의 1/2'],
        ['1/2 경과 후', '환불 없음'],
      ])}
      <p class="fine">경과 비율은 시작된 회차 수를 총 회차 수로 나눈 값입니다. 12회 과정에서 4회가 시작되었다면 정확히 1/3이므로 1/2 경과 전 구간을 적용합니다. 첫 수업 전에는 위 개강 전 기준을 따릅니다.</p>
    </section>
    <section class="guide-sec" aria-labelledby="g-etc">
      <h2 id="g-etc">함께 알아 두세요</h2>
      <ul class="guide-list">
        <li>환불액은 원 단위 미만을 버리고, 취소 수수료는 결제액에서 환불액을 뺀 금액입니다.</li>
        <li>취소는 예약 한 건 전체 단위로 처리합니다. 일부 좌석만 취소하려면 전체 취소 후 다시 예매해 주세요.</li>
        <li>센터 사정으로 회차가 취소되면 해당 회차 예약은 수수료 없이 전액 환불하고 알림함으로 안내해 드립니다.</li>
        <li>대기 승격 안내를 받은 뒤 24시간 안에 결제하지 않으면 다음 순번으로 넘어갑니다.</li>
      </ul>
      <div class="guide-actions"><a class="btn btn-primary" href="#/me/bookings">예약 내역에서 취소하기</a></div>
    </section>`);
}

export function renderGuideVisit(el) {
  el.innerHTML = shell('visit', '관람 안내/오시는 길', '한빛아트센터는 소극장, 창작공방, 연습실, 미술실을 갖춘 시립 문화시설입니다. 방문 전에 운영 시간과 주차 안내를 확인해 주세요.', `
    <section class="guide-sec" aria-labelledby="g-place">
      <h2 id="g-place">오시는 길</h2>
      <dl class="spec guide-spec">
        <dt>주소</dt><dd>한빛시 문화로 120 한빛아트센터</dd>
        <dt>대중교통</dt><dd>시내버스 문화로 정류장에서 내려 도보 3분, 한빛시청역 2번 출구에서 도보 10분</dd>
        <dt>주차</dt><dd>지하 1층, 지하 2층 주차장(120면). 공연, 체험, 강좌 이용 시 3시간 무료입니다. 주차장 공사로 12월 한 달간은 지하 2층만 이용할 수 있습니다.</dd>
      </dl>
    </section>
    <section class="guide-sec" aria-labelledby="g-hours">
      <h2 id="g-hours">운영 시간</h2>
      ${table('운영 시간', ['구분', '시간'], [
        ['시설 운영', '화요일 - 일요일 09:00 - 22:00 (월요일, 1월 1일 휴관)'],
        ['예약 문의', '평일 09:00 - 18:00, 031-000-1200'],
        ['현장 매표소', '공연 시작 1시간 전부터'],
      ])}
    </section>
    <section class="guide-sec" aria-labelledby="g-watch">
      <h2 id="g-watch">관람 안내</h2>
      <ul class="guide-list">
        <li>공연 시작 20분 전부터 입장할 수 있으며, 시작 후에는 입장이 제한될 수 있습니다.</li>
        <li>할인으로 예매하신 분은 입장(수업) 당일 현장에서 증빙을 보여 주세요. 사이트에서는 증빙을 받지 않습니다.</li>
        <li>공연장 안에서는 촬영, 녹음, 음식물 반입을 할 수 없습니다.</li>
      </ul>
    </section>
    <section class="guide-sec" aria-labelledby="g-access">
      <h2 id="g-access">장애인 편의</h2>
      <ul class="guide-list">
        <li>휠체어석은 소극장 R석 J열 양끝 4석입니다. 예매 후 예약 문의 031-000-1200으로 알려 주시면 자리를 안내해 드립니다.</li>
        <li>주차장 각 층 엘리베이터 앞에 장애인 전용 주차 구역이 있고, 모든 층에 장애인 화장실이 있습니다.</li>
        <li>보조견과 함께 입장하실 수 있습니다.</li>
      </ul>
    </section>`);
}

export function renderGuideCourse(el) {
  el.innerHTML = shell('course', '수강 신청 안내', '정규 강좌는 12주 동안 매주 한 번 같은 시간에 진행하는 과정입니다. 과정 전체를 한 번에 신청하고 결제합니다.', `
    <section class="guide-sec" aria-labelledby="g-apply">
      <h2 id="g-apply">신청 방법</h2>
      <ol class="guide-list">
        <li>정규 강좌 목록에서 강좌를 고르고 상세 화면에서 수강 신청을 누릅니다.</li>
        <li>할인 유형을 고른 뒤 결제하면 수강 신청이 확정됩니다. 결제 전 10분 동안 자리를 잡아 둡니다.</li>
        <li>확정된 신청은 예약 내역에서 수업 일정과 함께 확인하실 수 있습니다.</li>
      </ol>
    </section>
    <section class="guide-sec" aria-labelledby="g-rule">
      <h2 id="g-rule">신청 기준</h2>
      ${table('정규 강좌 신청 기준', ['항목', '기준'], [
        ['신청 기간', '판매 시작일부터 개강 전까지'],
        ['신청 한도', '1인 1건(과정 전체 12회)'],
        ['할인', '장애인 50%, 국가유공자 50%, 다자녀 30% (동반 할인 없음)'],
        ['정원이 찬 경우', '대기 신청을 받으며, 대기는 개강 전까지만 유지합니다'],
      ])}
      <p class="fine">취소와 환불은 개강 전과 개강 후 기준이 다릅니다. 취소/환불 규정에서 자세히 확인해 주세요.</p>
      <div class="guide-actions"><a class="btn btn-primary" href="#/programs?type=COURSE">정규 강좌 보기</a><a class="btn btn-secondary" href="#/guide/refund">취소/환불 규정</a></div>
    </section>`);
}
