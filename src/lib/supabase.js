import { createClient } from '@supabase/supabase-js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;

// 환경 변수가 없어도 화면과 단위 테스트는 동작해야 합니다. 이때 클라이언트는 null 입니다.
export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

if (!supabase) {
  console.error('VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env 파일을 확인해 주세요.');
}

export const APP_ENV = import.meta.env?.VITE_ENV ?? 'local';
