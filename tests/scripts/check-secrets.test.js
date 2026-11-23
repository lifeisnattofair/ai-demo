import { describe, it, expect } from 'vitest';
import { scanForSecrets } from '../../scripts/check-secrets.mjs';

const hit = (content) => scanForSecrets([{ path: 'a.js', content }]);

describe('scanForSecrets', () => {
  it('detects test secret key', () => {
    const r = hit('const k="' + 'test_' + 'sk_abc123' + '"');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: 'a.js', line: 1, pattern: 'pg-secret' });
  });
  it('detects live keys', () => {
    expect(hit('x=' + 'live_' + 'gck_x1')[0].pattern).toBe('pg-secret');
    expect(hit('x=' + 'live_' + 'sk_x1')[0].pattern).toBe('pg-secret');
  });
  it('detects JWT-shaped service key', () => {
    const jwt = 'ey' + 'J' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.payload.sig';
    const r = hit('a\nKEY=' + jwt);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ line: 2, pattern: 'jwt' });
  });
  it('ignores empty env example lines', () => {
    expect(hit('SUPABASE_SERVICE_ROLE_KEY=\nVITE_ENV=local')).toHaveLength(0);
  });
});
