// Supabase PostgrestError is a plain object with `.message`, not an Error
// instance, so `err instanceof Error` fails and the caller falls back to a
// generic message that hides the real reason. This helper reads `.message`
// from either.
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return 'Unknown error';
}
