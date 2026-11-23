import { execSync } from 'node:child_process';

// 로컬 Supabase 접속 값을 `supabase status -o env`에서 읽어 process.env에 채웁니다(이미 있으면 유지).
export default function setup() {
  if (process.env.API_URL && process.env.ANON_KEY && process.env.SERVICE_ROLE_KEY) return;
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// 시험이 끝나면 검수용 시계와 모의 결제 설정을 되돌려 로컬 개발 화면이 어긋나지 않게 합니다.
export async function teardown() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.API_URL, process.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.from('app_settings').upsert([
    { key: 'clock_enabled', value: true },
    { key: 'clock_offset_ms', value: 0 },
    { key: 'pg_mock_mode', value: 'APPROVE' },
    { key: 'env', value: 'local' },
  ]);
}
