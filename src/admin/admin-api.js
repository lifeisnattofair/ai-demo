// 관리자 화면용 Supabase 래퍼. 조회는 RLS 가 역할에 맞는 행만 돌려주고, 변경은 admin_* 함수로만 합니다.
import { supabase } from '../lib/supabase.js';
import { ApiError, api as userApi, fromDbError, messageFor } from '../lib/api.js';

const sweepDue = () => userApi.sweepDue();

const MESSAGES = {
  FORBIDDEN: '이 작업을 할 권한이 없습니다. 담당 역할을 확인해 주세요.',
  UNAUTHENTICATED: '로그인이 끝났습니다. 다시 로그인해 주세요.',
  NOT_FOUND: '대상을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.',
  INVALID_TITLE: '프로그램명을 100자 안으로 입력해 주세요.',
  INVALID_TYPE: '프로그램 유형을 선택해 주세요.',
  TYPE_LOCKED: '회차가 있는 프로그램은 유형을 바꿀 수 없습니다. 새 프로그램으로 등록해 주세요.',
  INVALID_SCHEDULE: '일정을 확인해 주세요. 종료는 시작보다 늦고, 판매는 시작 전에 끝나야 하며, 지난 일시는 쓸 수 없습니다.',
  INVALID_CAPACITY: '정원은 1명 이상의 숫자로 입력해 주세요. 공연 정원은 좌석 수로 정해집니다.',
  CAPACITY_BELOW_SOLD: '판매, 선점, 대기 배정된 수량보다 정원을 작게 줄일 수 없습니다. 현재 사용 수량 이상으로 입력해 주세요.',
  LESSONS_LOCKED: '판매가 시작된 강좌는 수업 일정을 바꿀 수 없습니다. 다른 항목만 저장해 주세요.',
  INVALID_PRICE: '가격은 1원 이상의 숫자로 입력해 주세요(0원 무료 회차는 결제 확인을 거칠 수 없습니다). 공연은 R, S, A석 가격이 모두 필요합니다.',
  OFFERING_CLOSED: '취소되었거나 취소 요청 중인 회차는 고칠 수 없습니다.',
  INVALID_REQUEST: '입력값을 확인한 뒤 다시 저장해 주세요.',
  PRICES_REQUIRED: '새 회차는 가격을 함께 입력해야 합니다. 가격을 입력한 뒤 다시 저장해 주세요.',
  NO_DISCOUNT: '할인을 적용하지 않은 매수는 증빙 확인 대상이 아닙니다. 할인 예약만 선택해 주세요.',
  BOOKING_CANCELLED: '취소된 예약은 증빙 확인을 기록할 수 없습니다. 확정 예약만 선택해 주세요.',
  INVALID_REASON: '취소 사유를 500자 안으로 입력해 주세요.',
  ALREADY_DECIDED: '이미 승인 또는 반려된 요청입니다. 목록을 새로 불러와 상태를 확인해 주세요.',
  CANCEL_NOT_APPROVED: '승인된 회차 취소 요청이 없습니다. 취소 요청을 먼저 승인해 주세요.',
  NOT_ALLOWED_IN_ENV: '이 환경에서는 쓸 수 없는 기능입니다. 환경 설정을 확인한 뒤 다시 시도해 주세요.',
  OFFERING_NOT_FOUND: '회차 정보를 찾을 수 없습니다. 목록을 새로 불러와 다시 확인해 주세요.',
};

export const adminMessage = (code) => MESSAGES[code] ?? messageFor(code);

function client() {
  if (!supabase) throw new ApiError('NO_BACKEND');
  return supabase;
}

async function rpc(name, args = {}) {
  const { data, error } = await client().rpc(name, args);
  if (error) {
    const e = fromDbError(error);
    // 회차 등록 가격 누락은 INVALID_REQUEST 의 details 로 구분합니다(0012).
    if (e.code === 'INVALID_REQUEST' && error.details === 'PRICES_REQUIRED') throw new ApiError('PRICES_REQUIRED', adminMessage('PRICES_REQUIRED'));
    throw new ApiError(e.code, adminMessage(e.code));
  }
  return data;
}

// Edge Function 호출. 오류 본문 {code, message} 를 ApiError 로 바꿉니다.
async function invoke(name, body) {
  const { data, error } = await client().functions.invoke(name, { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* 본문이 JSON 이 아닐 수 있습니다. */ }
    const code = payload?.code ?? 'UNKNOWN';
    // 함수 런타임 오류(영문)는 그대로 보이지 않고 우리 문구로 바꿉니다.
    const msg = /[가-힣]/.test(payload?.message ?? '') ? payload.message : adminMessage(code);
    throw new ApiError(code, msg);
  }
  return data;
}

async function query(builder) {
  const { data, error } = await builder;
  if (error?.code === '22P02') return null; // 주소의 id 가 uuid 형식이 아님
  if (error) throw new ApiError('UNKNOWN', adminMessage('UNKNOWN'));
  return data;
}

export const adminApi = {
  async session() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
  },
  onAuthChange(cb) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.code === 'user_banned'
        ? '이용할 수 없는 계정입니다. 관리자 계정으로 로그인해 주세요.'
        : '이메일 또는 비밀번호가 맞지 않습니다. 확인 후 다시 입력해 주세요.';
      throw new ApiError(error.code ?? 'AUTH', msg);
    }
    return data;
  },
  async signOut() {
    if (supabase) await supabase.auth.signOut();
  },
  // 내 프로필(본인 행만 읽힘)
  async me(userId) {
    return query(client().from('profiles').select('id, name, role').eq('id', userId).maybeSingle());
  },

  // 기한이 지난 대기 승격과 D-2 배정분을 먼저 처리한 뒤 보여 줍니다(QA D-09).
  async dashboard() {
    await sweepDue();
    return rpc('staff_dashboard');
  },

  // 프로그램
  async programs() {
    return (await query(client().from('programs')
      .select('id, type, title, venue, is_public, created_at, offerings(id)')
      .order('created_at', { ascending: false }))) ?? [];
  },
  async program(id) {
    return query(client().from('programs')
      .select('id, type, title, summary, description, venue, audience, is_public, discount_enabled, poster_image, poster_tone, poster_series, poster_title, poster_sub, '
        + 'offerings(id, starts_at, ends_at, capacity, status, sale_starts_at, sale_ends_at)')
      .eq('id', id).maybeSingle());
  },
  saveProgram: (p) => rpc('admin_upsert_program', { p }),

  // 회차
  async offerings() {
    return (await query(client().from('offerings')
      .select('id, program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at, status, program:programs(id, title, type)')
      .order('starts_at'))) ?? [];
  },
  async offering(id) {
    return query(client().from('offerings')
      .select('id, program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at, status, '
        + 'program:programs(id, title, type), prices:offering_prices(grade, price), lessons:course_lessons(seq, starts_at)')
      .eq('id', id).maybeSingle());
  },
  async offeringStats(programId = null) {
    return (await rpc('staff_offering_stats', { p_program: programId })) ?? [];
  },
  saveOffering: (p) => rpc('admin_upsert_offering', { p }),
  async seatMap(offeringId) {
    return (await query(client().from('inventory_seats')
      .select('seat_id, status, seat:seats(row_label, seat_no, grade)')
      .eq('offering_id', offeringId))) ?? [];
  },
  async offeringBookings(offeringId) {
    return (await rpc('staff_offering_bookings', { p_offering: offeringId })) ?? [];
  },
  viewMember: (userId) => rpc('admin_view_member', { p_user: userId }),

  // 예약 내역, 증빙 확인(0012)
  async bookings(f = {}) {
    return (await rpc('staff_bookings', {
      p_from: f.from || null, p_to: f.to || null, p_program: f.program || null, p_offering: f.offering || null,
      p_statuses: f.statuses?.length ? f.statuses : null, p_discount: f.discount || null, p_field: f.field || null, p_q: f.q || null,
    })) ?? [];
  },
  markProof: (itemId, checked) => rpc('admin_mark_proof', { p_item: itemId, p_checked: checked }),

  // 대기자
  async waitlist(offeringId = null) {
    await sweepDue();
    return (await rpc('staff_waitlist', { p_offering: offeringId })) ?? [];
  },

  // 결제/환불(정산 담당). 결제 원본은 paymentRaw 로만 엽니다.
  async payments(from, to) {
    return (await rpc('staff_payments', { p_from: from || null, p_to: to || null })) ?? [];
  },
  async refunds(from, to) {
    return (await rpc('staff_refunds', { p_from: from || null, p_to: to || null })) ?? [];
  },
  paymentRaw: (paymentId) => rpc('admin_payment_raw', { p_payment: paymentId }),

  // 회차 취소 요청/승인. 승인 뒤 일괄 환불은 payments-cancel(INSTITUTION)이 합니다.
  async cancelRequests() {
    return (await rpc('staff_cancel_requests')) ?? [];
  },
  requestOfferingCancel: (offeringId, reason) => rpc('admin_request_offering_cancel', { p_offering: offeringId, p_reason: reason }),
  decideOfferingCancel: (requestId, approve) => rpc('admin_decide_offering_cancel', { p_req: requestId, p_approve: approve }),
  runInstitutionCancel: (offeringId) => invoke('payments-cancel', { offeringId, mode: 'INSTITUTION' }),

  // 정산
  async settlement(from, to) {
    return (await rpc('staff_settlement', { p_from: from || null, p_to: to || null })) ?? [];
  },

  // 시스템: 검수용 시계, 시연 데이터 초기화, 작업 이력(0013)
  clock: () => rpc('staff_clock'),
  setClock: (offsetMs) => rpc('admin_set_clock', { p_offset_ms: offsetMs }),
  resetDemo: () => rpc('admin_reset_demo'),
  async audit(f = {}) {
    return (await rpc('staff_audit', { p_from: f.from || null, p_to: f.to || null, p_actor: f.actor || null, p_action: f.action || null })) ?? [];
  },
};
