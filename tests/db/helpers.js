import { createClient } from '@supabase/supabase-js';

export const DEMO_PASSWORD = 'Demo-1234!';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient() {
  return createClient(process.env.API_URL, process.env.SERVICE_ROLE_KEY, opts);
}

export async function userClient(email) {
  const c = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw error;
  return c;
}

export async function resetDb(baseIso) {
  const { error } = await adminClient().rpc('seed_demo', { base: baseIso });
  if (error) throw error;
  await setClock(0);
}

export async function setClock(offsetMs) {
  const { error } = await adminClient()
    .from('app_settings')
    .upsert([
      { key: 'clock_enabled', value: true },
      { key: 'clock_offset_ms', value: offsetMs },
    ]);
  if (error) throw error;
}
