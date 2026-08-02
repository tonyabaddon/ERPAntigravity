/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Eye } from 'lucide-react';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface JEPreviewLine {
  accountCode: string;  // e.g. '1-1210'
  accountName: string;  // e.g. 'BCA Operasional'
  debit: number;        // 0 if credit-side
  credit: number;       // 0 if debit-side
}

export interface JournalEntryPreviewProps {
  lines: JEPreviewLine[];
  caption?: string;     // optional sub-line below balanced chip
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Format number using Indonesian locale (thousands separator = .) */
function formatAmount(n: number): string {
  if (n === 0) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function JournalEntryPreview({
  lines,
  caption,
}: JournalEntryPreviewProps) {
  // Compute totals
  const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  // Determine balance status
  const isBalanced = totalDebit === totalCredit;

  return (
    <div className="je-preview p-4">
      {/* Header: Eye icon + Title + Balanced chip */}
      <div className="flex items-center gap-2 mb-2">
        <Eye className="w-4 h-4 text-amber-800" />
        <strong className="text-caleo-13 text-amber-900">Journal Entry Preview</strong>

        {/* Balanced / Imbalanced chip on right */}
        <span className={`chip-soft ml-auto ${
          isBalanced
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-rose-100 text-rose-800'
        }`}>
          {isBalanced ? '✓ Balanced' : '⚠ Imbalanced'}
        </span>
      </div>

      {/* Inner table with white background */}
      <div className="bg-white rounded overflow-hidden">
        <table className="w-full text-xs">
          {/* Header row */}
          <thead style={{ background: '#f9fafb' }}>
            <tr className="text-caleo-10 uppercase font-extrabold text-gray-600">
              <th className="text-left py-2 px-3">#</th>
              <th className="text-left py-2 px-3">Akun</th>
              <th className="text-right py-2 px-3">Debit</th>
              <th className="text-right py-2 px-3">Kredit</th>
            </tr>
          </thead>

          {/* Data rows */}
          <tbody className="row-divider">
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td className="py-2 px-3">{idx + 1}</td>
                <td className="py-2 px-3 font-mono">
                  {line.accountCode} {line.accountName}
                </td>
                <td className="text-right py-2 px-3">
                  {line.debit > 0 ? (
                    <span className="font-bold text-emerald-700">
                      {formatAmount(line.debit)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-right py-2 px-3">
                  {line.credit > 0 ? (
                    <span className="font-bold text-rose-700">
                      {formatAmount(line.credit)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>

          {/* Footer with totals */}
          <tfoot style={{ background: 'var(--color-caleo-cloud)' }}>
            <tr className="font-extrabold" style={{ color: '#1e3d60' }}>
              <td colSpan={2} className="py-2 px-3 text-right">
                Total
              </td>
              <td className="text-right py-2 px-3 text-emerald-700">
                {formatAmount(totalDebit)}
              </td>
              <td className="text-right py-2 px-3 text-rose-700">
                {formatAmount(totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Optional caption below table */}
      {caption && (
        <p className="text-caleo-11 text-amber-900 mt-2">
          {caption}
        </p>
      )}
    </div>
  );
}
