// Supabase RPC, Edge Function, 인증 래퍼. 오류는 ApiError(code, message)로 통일합니다.
import { supabase } from './supabase.js';

const MESSAGES = {
  SEAT_TAKEN: '방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.',
  LIMIT_EXCEEDED: '1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.',
  SOLD_OUT: '매진되었습니다. 대기 신청을 하실 수 있습니다.',
  NOT_ON_SALE: '지금은 예매할 수 없는 회차입니다. 판매 기간을 확인해 주세요.',
  HOLD_EXPIRED: '좌석 선점 시간이 지나 결제가 진행되지 않았습니다. 좌석을 다시 선택해 주세요.',
  NOT_OWNER: '본인 예약만 처리할 수 있습니다.',
  ALREADY_WAITING: '이미 대기 신청한 회차입니다.',
  NOT_SOLD_OUT: '아직 좌석이 남아 있어 대기 신청을 할 수 없습니다. 바로 예매해 주세요.',
  NOT_PROMOTED: '대기 순번이 아직 오지 않았습니다.',
  PAYMENT_IN_PROGRESS: '결제가 진행 중입니다. 잠시 후 내 예약에서 확인해 주세요.',
  UNAUTHENTICATED: '로그인이 필요합니다. 로그인 후 다시 시도해 주세요.',
  ACTIVE_BOOKING: '진행 중인 예약이 있어 탈퇴할 수 없습니다. 예약을 취소한 뒤 다시 시도해 주세요.',
  INVALID_PHONE: '휴대폰 번호 형식이 올바르지 않습니다. 숫자 10자리 또는 11자리로 입력해 주세요.',
  INVALID_NAME: '이름을 입력해 주세요. 50자까지 입력할 수 있습니다.',
  DEMO_ACCOUNT_LOCKED: '시연용 계정은 변경할 수 없습니다. 새 계정을 만들어 사용해 주세요.',
  PROFILE_REQUIRED: '가입 때 연락처 입력이 끝나지 않았습니다. 이름과 휴대폰 번호를 입력한 뒤 다시 시도해 주세요.',
  NO_BACKEND: '서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};
const GENERIC = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function messageFor(code) {
  return MESSAGES[code] ?? GENERIC;
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message ?? messageFor(code));
    this.name = 'ApiError';
    this.code = code;
  }
}

function client() {
  if (!supabase) throw new ApiError('NO_BACKEND');
  return supabase;
}

// DB 함수는 raise exception 의 message 에 코드를 담습니다.
export function fromDbError(error) {
  const raw = String(error?.message ?? '');
  // 가입 중 연락처 입력이 끝나지 않아 프로필이 없는 계정은 선점/대기 insert 의 FK 에서 막힙니다.
  if (/violates foreign key constraint "(holds|waitlist)_user_id_fkey"/.test(raw)) return new ApiError('PROFILE_REQUIRED');
  const code = /^[A-Z][A-Z_]+$/.test(raw) ? raw : (raw.match(/\b([A-Z]{3,}(?:_[A-Z]+)+)\b/)?.[1] ?? 'UNKNOWN');
  return new ApiError(code);
}

async function rpc(name, args) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw fromDbError(error);
  return data;
}

// 기한이 지난 대기 승격과 D-2 배정분을 조회 전에 처리합니다(QA D-09). 다른 회원의 선점을 기다리지 않게 합니다.
// 로그인한 경우에만 부르고, 실패해도 조회는 그대로 이어 갑니다(1분마다 서버 예약 작업도 같은 처리를 합니다).
async function sweepDue() {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;
    const { error } = await supabase.rpc('sweep_due_offerings');
    if (error) console.error(error);
  } catch (e) {
    console.error(e);
  }
}

async function invoke(name, body) {
  const { data, error } = await client().functions.invoke(name, { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* 본문이 JSON 이 아닐 수 있습니다. */ }
    const code = payload?.code ?? 'UNKNOWN';
    // 함수가 정해 둔 한국어 안내만 화면에 씁니다. 실행 환경의 영어 원문은 콘솔에만 남깁니다.
    const own = typeof payload?.message === 'string' && /[가-힣]/.test(payload.message) ? payload.message : null;
    if (!own && payload?.message) console.error(`[${name}] ${code}: ${payload.message}`);
    throw new ApiError(code, own ?? messageFor(code));
  }
  return data;
}

function authMessage(error) {
  const code = error?.code ?? '';
  const msg = String(error?.message ?? '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return '이메일 또는 비밀번호가 맞지 않습니다. 확인 후 다시 입력해 주세요.';
  }
  if (code === 'user_already_exists' || /already registered/i.test(msg)) {
    return '이미 가입된 이메일입니다. 로그인하거나 다른 이메일을 입력해 주세요.';
  }
  if (code === 'weak_password') return '비밀번호는 영문과 숫자를 함께 8자 이상 입력해 주세요.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (code === 'user_banned') return '이용할 수 없는 계정입니다. 탈퇴한 계정으로는 로그인할 수 없습니다. 새로 가입해 주세요.';
  return GENERIC;
}

// 어떤 오류든 화면에 보여 줄 한국어 안내로 바꿉니다.
export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  return authMessage(err);
}

/** 코드별로 정해 둔 안내가 있는 오류인지(없으면 화면은 일반 안내를 씁니다). */
export function isKnownError(err) {
  return err instanceof ApiError && err.code !== 'UNKNOWN' && err.message !== GENERIC && /[가-힣]/.test(err.message);
}

async function authCall(promise) {
  const { data, error } = await promise;
  if (error) throw new ApiError(error.code ?? 'AUTH', authMessage(error));
  return data;
}

const PROGRAM_COLUMNS = 'id, type, title, summary, description, venue, audience, poster_image, poster_tone, poster_series, poster_title, poster_sub, details, '
  + 'offerings(id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at, status, prices:offering_prices(grade, price), lessons:course_lessons(seq, starts_at))';

export const api = {
  messageFor,

  // 인증
  async getSession() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
  },
  onAuthChange(cb) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
    return () => data.subscription.unsubscribe();
  },
  signUp: (email, password) => authCall(client().auth.signUp({ email, password })),
  signIn: (email, password) => authCall(client().auth.signInWithPassword({ email, password })),
  async signOut() {
    await authCall(client().auth.signOut());
  },
  resetPassword: (email) =>
    authCall(client().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}` })),
  saveConsent: (data) => authCall(client().auth.updateUser({ data })),
  updatePassword: (password) => authCall(client().auth.updateUser({ password })),

  // 회원
  completeVerification: (name, phone) => rpc('complete_mock_verification', { p_name: name, p_phone: phone }),
  updateContact: (name, phone) => rpc('update_my_contact', { p_name: name, p_phone: phone }),
  async getProfile() {
    const session = await api.getSession();
    if (!session) return null;
    const { data, error } = await client().from('profiles').select('id, name, phone, verified_at').eq('id', session.user.id).maybeSingle();
    if (error) throw fromDbError(error);
    return data;
  },
  withdraw: () => rpc('withdraw_member'),

  // 예매
  holdSeats: (offeringId, seatIds) => rpc('hold_seats', { p_offering: offeringId, p_seat_ids: seatIds }),
  holdCapacity: (offeringId, qty) => rpc('hold_capacity', { p_offering: offeringId, p_qty: qty }),
  releaseHold: (holdId) => rpc('release_hold', { p_hold: holdId }),
  remainingCapacity: (offeringId) => rpc('remaining_capacity', { p_offering: offeringId }),
  preparePayment: (holdId, items, amount, orderId) =>
    rpc('prepare_payment', { p_hold: holdId, p_items: items, p_amount: amount, p_order_id: orderId }),
  joinWaitlist: (offeringId, qty) => rpc('join_waitlist', { p_offering: offeringId, p_qty: qty }),
  cancelWaitlist: (id) => rpc('cancel_waitlist', { p_id: id }),
  holdForPromotion: (waitlistId) => rpc('hold_for_promotion', { p_waitlist: waitlistId }),
  sweepOffering: (offeringId) => rpc('sweep_offering', { p_offering: offeringId }),
  sweepDue,

  // 좌석/인원 선택 화면용 조회
  offeringSeatMap: (offeringId) => rpc('offering_seat_map', { p_offering: offeringId }),
  myOfferingQty: async (offeringId) => Number(await rpc('my_offering_qty', { p_offering: offeringId })) || 0,
  async myActiveHold(offeringId) {
    const rows = await rpc('my_active_hold', { p_offering: offeringId });
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  },
  async getMyHold(holdId) {
    const rows = await rpc('get_my_hold', { p_hold: holdId });
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  },
  async myBookingItems(bookingId) {
    return (await rpc('my_booking_items', { p_booking: bookingId })) ?? [];
  },
  async getOffering(id) {
    await sweepDue();
    const { data, error } = await client()
      .from('offerings')
      .select('id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at, status, prices:offering_prices(grade, price), '
        + 'program:programs(id, type, title, venue, poster_image, poster_tone, discount_enabled)')
      .eq('id', id)
      .maybeSingle();
    // 주소의 id 가 uuid 형식이 아니면 없는 회차로 봅니다.
    if (error?.code === '22P02') return null;
    if (error) throw fromDbError(error);
    return data;
  },

  // 조회: 프로그램 목록과 상세는 비회원도 봅니다.
  async listPrograms() {
    const { data, error } = await client().from('programs').select(PROGRAM_COLUMNS).eq('is_public', true);
    if (error) throw fromDbError(error);
    return data;
  },
  async getProgram(id) {
    await sweepDue();
    const { data, error } = await client().from('programs').select(PROGRAM_COLUMNS).eq('id', id).eq('is_public', true).maybeSingle();
    // 주소의 id 가 uuid 형식이 아니면 없는 프로그램으로 봅니다.
    if (error?.code === '22P02') return null;
    if (error) throw fromDbError(error);
    return data;
  },
  // 마이페이지: 본인 행만 돌려주는 조회 함수(0009_my_page.sql)
  async myBookings() {
    return (await rpc('my_bookings_overview', {})) ?? [];
  },
  async myBooking(id) {
    const { data, error } = await client().rpc('my_bookings_overview', { p_booking: id });
    // 주소의 id 가 uuid 형식이 아니면 없는 예약으로 봅니다.
    if (error?.code === '22P02') return null;
    if (error) throw fromDbError(error);
    return data?.[0] ?? null;
  },
  async myWaitlist() {
    await sweepDue();
    return (await rpc('my_waitlist_overview', {})) ?? [];
  },
  async myCounts() {
    return (await rpc('my_counts', {})) ?? { upcoming: 0, waitlist: 0, unread: 0 };
  },
  async myNotifications() {
    await sweepDue();
    return (await rpc('my_notifications', {})) ?? [];
  },
  markNotificationRead: (id) => rpc('mark_notification_read', { p_id: id }),
  markAllNotificationsRead: () => rpc('mark_all_notifications_read', {}),

  // Edge Functions
  confirmPayment: (paymentKey, orderId, amount) => invoke('payments-confirm', { paymentKey, orderId, amount }),
  cancelBooking: (bookingId) => invoke('payments-cancel', { bookingId }),
};
