import { execSync } from 'node:child_process';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// 로컬 Supabase 접속 값을 `supabase status -o env`에서 읽어 process.env에 채웁니다(이미 있으면 유지).
export default async function setup() {
  if (!(process.env.API_URL && process.env.ANON_KEY && process.env.SERVICE_ROLE_KEY)) {
    const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  // 1분마다 도는 기한 만료 예약 작업(pg_cron)이 시계를 옮기는 시험 사이에 끼어들지 않게 멈춥니다(0017).
  // 시험은 예약 작업의 실행 시점에 기대지 않고, 화면이 부르는 조회 경로(sweep_due_offerings)로만 처리를 확인합니다.
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.API_URL, process.env.SERVICE_ROLE_KEY, opts);
  const { error } = await db.from('app_settings').upsert([{ key: 'sweep_cron_paused', value: true }]);
  if (error) throw error;
  // 끝날 때 되돌리는 함수를 돌려줍니다(기본 내보내기 setup 은 이 반환값으로 teardown 을 부릅니다).
  return teardown;
}

// 시험이 끝나면 검수용 시계와 모의 결제 설정, 예약 작업을 되돌려 로컬 개발 화면이 어긋나지 않게 합니다.
export async function teardown() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.API_URL, process.env.SERVICE_ROLE_KEY, opts);
  await db.from('app_settings').upsert([
    { key: 'clock_enabled', value: true },
    { key: 'clock_offset_ms', value: 0 },
    { key: 'pg_mock_mode', value: 'APPROVE' },
    { key: 'env', value: 'local' },
    { key: 'sweep_cron_paused', value: false },
  ]);
}
