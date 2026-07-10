/**
 * Minimal JWT payload decoder — reads claims without signature verification.
 * Handles base64url encoding (URL-safe characters replaced before atob).
 */
export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    if (!payload) return {};
    return JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}
