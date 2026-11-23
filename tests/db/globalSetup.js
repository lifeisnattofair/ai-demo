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
