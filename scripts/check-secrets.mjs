import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PATTERNS = [
  { name: 'pg-secret', re: new RegExp('test_' + 'sk_|live_' + '(?:gck|gsk|ck|sk)_') },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{20,}\./ },
];

export function scanForSecrets(files) {
  const found = [];
  for (const { path, content } of files) {
    const lines = content.split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const { name, re } of PATTERNS) {
        if (re.test(text)) found.push({ path, line: i + 1, pattern: name });
      }
    });
  }
  return found;
}

function loadTrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const files = [];
  // Planning docs quote the pattern names literally; they never hold real keys.
  const skip = (p) => p.startsWith('docs/superpowers/');
  for (const path of out.split('\0').filter(Boolean)) {
    if (skip(path)) continue;
    let buf;
    try {
      buf = readFileSync(path);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue; // binary
    files.push({ path, content: buf.toString('utf8') });
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = scanForSecrets(loadTrackedFiles());
  if (hits.length > 0) {
    for (const h of hits) console.error(`${h.path}:${h.line} ${h.pattern}`);
    console.error(`check:secrets failed (${hits.length})`);
    process.exit(1);
  }
  console.log('check:secrets ok');
}
