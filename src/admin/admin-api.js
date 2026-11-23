// 관리자 화면용 Supabase 래퍼. 조회는 RLS 가 역할에 맞는 행만 돌려주고, 변경은 admin_* 함수로만 합니다.
import { supabase } from '../lib/supabase.js';
import { ApiError, fromDbError, messageFor } from '../lib/api.js';

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
  INVALID_PRICE: '가격을 0원 이상의 숫자로 입력해 주세요. 공연은 R, S, A석 가격이 모두 필요합니다.',
  OFFERING_CLOSED: '취소되었거나 취소 요청 중인 회차는 고칠 수 없습니다.',
  INVALID_REQUEST: '입력값을 확인한 뒤 다시 저장해 주세요.',
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
    throw new ApiError(e.code, adminMessage(e.code));
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

  dashboard: () => rpc('staff_dashboard'),

  // 프로그램
  async programs() {
    return (await query(client().from('programs')
      .select('id, type, title, venue, is_public, created_at, offerings(id)')
      .order('created_at', { ascending: false }))) ?? [];
  },
  async program(id) {
    return query(client().from('programs')
      .select('id, type, title, summary, description, venue, audience, is_public, poster_image, poster_tone, poster_series, poster_title, poster_sub, '
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
};
