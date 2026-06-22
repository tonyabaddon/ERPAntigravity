// Shared test setup untuk Akuntansi Phase 1 integration tests
import { loadEnv } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const env = loadEnv('test', process.cwd(), '');

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY required for integration tests');
}

export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

export const TEST_PREFIX = `AKUNTANSI-P1-${Date.now()}`;

/** Set auth.uid for SECURITY DEFINER RPC testing. Pass null to clear. */
export async function setAuthUid(uid: string | null): Promise<void> {
  if (uid === null) {
    await supabaseAdmin.rpc('set_config' as any, { key: 'request.jwt.claim.sub', value: '', is_local: true });
  } else {
    await supabaseAdmin.rpc('set_config' as any, { key: 'request.jwt.claim.sub', value: uid, is_local: true });
  }
}
