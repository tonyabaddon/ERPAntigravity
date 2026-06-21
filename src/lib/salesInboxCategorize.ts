import type { ConversationState } from '../types';

export type InboxCategory = 'butuhAksi' | 'aiAktif' | 'menunggu' | 'riwayat';

const TERMINAL: ReadonlySet<ConversationState> = new Set(['COMPLETED', 'CANCELLED']);
const ESCALATED_OR_NEEDS_ADMIN: ReadonlySet<ConversationState> = new Set([
  'ESCALATED_ADMIN', 'ESCALATED_WIRING', 'BOOKED', 'TIMEOUT_REMINDER',
]);
const AI_STAGES: ReadonlySet<ConversationState> = new Set([
  'GREETING', 'COLLECTING', 'CLARIFYING', 'STOCK_CHECK', 'CONFIRMING', 'ADD_MORE', 'APPROVED',
]);
const MENUNGGU: ReadonlySet<ConversationState> = new Set(['DELIVERY']);

export function categorize(conv: { state: ConversationState; ai_active: boolean }): InboxCategory {
  if (TERMINAL.has(conv.state)) return 'riwayat';
  if (ESCALATED_OR_NEEDS_ADMIN.has(conv.state)) return 'butuhAksi';
  if (!conv.ai_active) return 'butuhAksi'; // manual override / takeover
  if (MENUNGGU.has(conv.state)) return 'menunggu';
  if (AI_STAGES.has(conv.state)) return 'aiAktif';
  return 'aiAktif'; // safe default for unknown non-terminal state
}

export function categoryCounts(
  convs: Array<{ state: ConversationState; ai_active: boolean }>
): Record<InboxCategory, number> {
  const counts: Record<InboxCategory, number> = { butuhAksi: 0, aiAktif: 0, menunggu: 0, riwayat: 0 };
  for (const c of convs) counts[categorize(c)] += 1;
  return counts;
}
