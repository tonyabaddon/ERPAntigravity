export type TenantErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'TENANT_SUSPENDED'
  | 'NOT_A_MEMBER'
  | 'SUBSCRIPTION_EXPIRED_READONLY'
  | 'MISSING_TENANT_CONTEXT';

const CODE_MAP: Record<string, TenantErrorCode> = {
  P0404: 'TENANT_NOT_FOUND',
  P0403: 'TENANT_SUSPENDED',   // could also be NOT_A_MEMBER; disambiguate by message
  P0402: 'SUBSCRIPTION_EXPIRED_READONLY',
  P0400: 'MISSING_TENANT_CONTEXT',
};

export function dispatchTenantError(err: unknown): TenantErrorCode | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: string; code?: string };
  let code: TenantErrorCode | null = null;

  // Prefer message-string match (server sets these as verbatim message)
  if (e.message === 'TENANT_NOT_FOUND') code = 'TENANT_NOT_FOUND';
  else if (e.message === 'TENANT_SUSPENDED') code = 'TENANT_SUSPENDED';
  else if (e.message === 'NOT_A_MEMBER') code = 'NOT_A_MEMBER';
  else if (e.message === 'SUBSCRIPTION_EXPIRED_READONLY') code = 'SUBSCRIPTION_EXPIRED_READONLY';
  else if (e.message === 'MISSING_TENANT_CONTEXT') code = 'MISSING_TENANT_CONTEXT';
  else if (e.code && CODE_MAP[e.code]) code = CODE_MAP[e.code];

  if (code && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vosi:tenant-error', { detail: { code } }));
  }
  return code;
}
