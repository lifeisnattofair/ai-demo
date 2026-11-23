// 로컬 Edge Functions 실행 도우미(Windows + Docker Desktop).
// Docker Desktop이 공유하지 않는 드라이브(예: E:)에 저장소가 있으면 함수 폴더가 컨테이너 안에서 빈 폴더로 보여
// 모든 요청이 BOOT_ERROR(「failed to determine entrypoint」)로 끝납니다.
// 이 도우미는 supabase/config.toml 과 supabase/functions 를 공유되는 임시 폴더(기본: OS 임시 폴더, C:)로 복사한 뒤
// 그 폴더를 작업 폴더로 `supabase functions serve` 를 실행합니다. 같은 project_id 라 이미 떠 있는 로컬 스택에 붙습니다.
// 함수 소스를 고치면 다시 실행해야 합니다(복사본을 씁니다). 사용: node scripts/functions-serve.mjs [임시 폴더]
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const work = resolve(process.argv[2] ?? join(tmpdir(), 'hanbit-functions'));
const dest = join(work, 'supabase');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(root, 'supabase', 'config.toml'), join(dest, 'config.toml'));
cpSync(join(root, 'supabase', 'functions'), join(dest, 'functions'), { recursive: true });

const args = ['supabase', 'functions', 'serve', '--workdir', work];
const envFile = join(root, 'supabase', 'functions', '.env');
if (existsSync(envFile)) args.push('--env-file', envFile);
console.log(`함수 복사본: ${dest}`);
const child = spawn('npx', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
