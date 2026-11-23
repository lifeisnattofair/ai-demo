// 화면용 현재 시각. 검수용 시계(app_now)와 어긋나지 않도록 서버 시각과의 차이를 한 번 맞춥니다.
// 정책 판단은 서버(app_now)가 하며, 이 값은 남은 시간 표시처럼 화면 표시에만 씁니다.
import { supabase } from './supabase.js';

let offsetMs = 0;

export async function syncClock() {
  if (!supabase) return;
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('app_now');
  if (error || !data) return;
  const mid = (t0 + Date.now()) / 2;
  offsetMs = new Date(data).getTime() - mid;
}

export function now() {
  return new Date(Date.now() + offsetMs);
}

export function setOffsetForTest(ms) {
  offsetMs = ms;
}
