// 로컬 Edge Functions 실행 도우미(Windows + Docker Desktop).
// Docker Desktop이 공유하지 않는 드라이브(예: E:)에 저장소가 있으면 함수 폴더가 컨테이너 안에서 빈 폴더로 보여
// 모든 요청이 BOOT_ERROR(「failed to determine entrypoint」)로 끝납니다.
// 이 도우미는 supabase/config.toml 과 supabase/functions 를 OS 임시 폴더 아래 새로 만든 폴더로 복사한 뒤
// 그 폴더를 작업 폴더로 `supabase functions serve` 를 실행합니다. 같은 project_id 라 이미 떠 있는 로컬 스택에 붙습니다.
// 복사 위치는 매번 새로 만든 임시 폴더만 쓰고 인자로 받지 않습니다(저장소 폴더를 지우지 않게).
// functions/.env 는 복사하지 않고 --env-file 로만 넘깁니다. 함수 소스를 고치면 다시 실행해야 합니다.
// 사용: npm run functions:serve
import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'hanbit-functions-'));
const dest = join(work, 'supabase');
cpSync(join(root, 'supabase', 'config.toml'), join(dest, 'config.toml'));
cpSync(join(root, 'supabase', 'functions'), join(dest, 'functions'), {
  recursive: true,
  filter: (src) => basename(src) !== '.env',
});

const args = ['functions', 'serve', '--workdir', work];
const envFile = join(root, 'supabase', 'functions', '.env');
if (existsSync(envFile)) args.push('--env-file', envFile);
console.log(`함수 복사본: ${dest}`);

// 셸을 거치지 않고 Supabase CLI(node_modules/supabase/dist/supabase.js)를 node 로 바로 실행해 공백이 든 경로도 인자 하나로 넘깁니다.
const cli = join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
