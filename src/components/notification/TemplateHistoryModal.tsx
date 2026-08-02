/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/notification/TemplateHistoryModal.tsx
// Sprint 3 Task 3.4 — versioning history modal for notification templates.
// Shows last 50 edits for a given template_id, with diff preview + restore.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';

interface HistoryRow {
  id: string;
  actor_user_id: string | null;
  old_content: string | null;
  new_content: string;
  edited_at: string;
}

interface Props {
  templateId: string;
  onClose: () => void;
  onRestore: (content: string) => void;
}

export function TemplateHistoryModal({ templateId, onClose, onRestore }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('tenant_notification_templates_history')
        .select('id, actor_user_id, old_content, new_content, edited_at')
        .eq('template_id', templateId)
        .order('edited_at', { ascending: false })
        .limit(50);
      if (!cancelled) {
        setRows(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  return (
    <div
      className="thm-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Riwayat perubahan template"
    >
      <div className="thm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="thm-header">
          <h2 className="thm-title">Riwayat perubahan template</h2>
          <button
            type="button"
            className="thm-close-btn"
            onClick={onClose}
            aria-label="Tutup"
          >
            ✕
          </button>
        </header>

        {loading && (
          <LoadingState label="Memuat riwayat…" inline className="thm-empty" />
        )}
        {!loading && rows.length === 0 && (
          <EmptyState inline message="Belum ada perubahan tersimpan untuk template ini." className="thm-empty" />
        )}
        {!loading && rows.map((r) => (
          <div key={r.id} className="thm-row">
            <div className="thm-row-meta">
              {new Date(r.edited_at).toLocaleString('id-ID')}
              {' · oleh '}
              {r.actor_user_id ? r.actor_user_id.slice(0, 8) + '...' : 'System'}
            </div>
            <details className="thm-details">
              <summary className="thm-summary">
                {r.new_content.slice(0, 80)}{r.new_content.length > 80 ? '...' : ''}
              </summary>
              {r.old_content != null && (
                <pre className="thm-pre thm-pre--old">Sebelum: {r.old_content}</pre>
              )}
              <pre className="thm-pre thm-pre--new">Sesudah: {r.new_content}</pre>
            </details>
            <button
              type="button"
              className="thm-restore-btn"
              onClick={() => onRestore(r.new_content)}
            >
              Restore versi ini
            </button>
          </div>
        ))}
      </div>

      <style>{`
        .thm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .thm-modal {
          background: white;
          padding: 24px;
          border-radius: 12px;
          max-width: 640px;
          width: 100%;
          max-height: 80vh;
          overflow: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }
        .thm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .thm-title {
          font-size: 16px;
          font-weight: 700;
          color: #0B2545;
          margin: 0;
        }
        .thm-close-btn {
          background: none;
          border: none;
          font-size: 16px;
          color: #64748B;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          line-height: 1;
        }
        .thm-close-btn:hover { background: #F1F5F9; }
        .thm-empty {
          font-size: 14px;
          color: #64748B;
          text-align: center;
          padding: 24px 0;
        }
        .thm-row {
          padding: 12px 0;
          border-bottom: 1px solid #E2E8F0;
        }
        .thm-row:last-child { border-bottom: none; }
        .thm-row-meta {
          font-size: 12px;
          color: #64748B;
          margin-bottom: 6px;
        }
        .thm-details { margin-bottom: 8px; }
        .thm-summary {
          font-size: 13px;
          color: #334155;
          cursor: pointer;
          user-select: none;
          padding: 4px 0;
        }
        .thm-summary:hover { color: #0B2545; }
        .thm-pre {
          white-space: pre-wrap;
          font-family: inherit;
          font-size: 12px;
          padding: 8px 10px;
          border-radius: 6px;
          margin: 6px 0 0;
          line-height: 1.5;
        }
        .thm-pre--old { background: #FEE2E2; color: #7F1D1D; }
        .thm-pre--new { background: #DCFCE7; color: #14532D; }
        .thm-restore-btn {
          font-size: 12px;
          font-weight: 600;
          color: #8B5CF6;
          background: none;
          border: 1px solid #DDD6FE;
          border-radius: 6px;
          padding: 4px 10px;
          cursor: pointer;
          margin-top: 4px;
        }
        .thm-restore-btn:hover { background: #F5F3FF; }
      `}</style>
    </div>
  );
}
