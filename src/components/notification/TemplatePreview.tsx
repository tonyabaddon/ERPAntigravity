// src/components/notification/TemplatePreview.tsx
// WhatsApp-style bubble preview with resolved sample data.
// Reused by Task 2.7 (PiutangWaReminderScreen) and Sprint 3 (universal editor).
interface TemplatePreviewProps {
  template: string;
  sampleData: Record<string, string>;
}

export function TemplatePreview({ template, sampleData }: TemplatePreviewProps) {
  // Simple {key} substitution (matches backend Go template)
  const rendered = Object.entries(sampleData).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, v),
    template
  );

  return (
    <div className="wa-preview">
      <div className="wa-header">
        <span className="wa-header-icon">🟢</span>
        <span>WhatsApp — Preview</span>
      </div>
      <div className="wa-bubble">
        {rendered.split('\n').map((line, i) => (
          <div key={i}>{line || <br />}</div>
        ))}
        <div className="wa-timestamp">✓✓ 09:00</div>
      </div>
      <div className="wa-sample-note">
        Data contoh: {Object.entries(sampleData).map(([k, v]) => `${k}=${v}`).join(', ')}
      </div>
      <style>{`
        .wa-preview {
          background: #ECE5DD; padding: 16px; border-radius: 12px;
          font-family: 'Inter', sans-serif;
        }
        .wa-header {
          background: #075E54; color: white; padding: 8px 12px;
          border-radius: 8px 8px 0 0; font-size: 13px; font-weight: 600;
          margin: -16px -16px 12px -16px;
        }
        .wa-header-icon { margin-right: 6px; }
        .wa-bubble {
          background: #DCF8C6; padding: 10px 12px; border-radius: 8px;
          font-size: 13.5px; line-height: 1.5; color: #303030;
          max-width: 320px; word-wrap: break-word;
        }
        .wa-timestamp { font-size: 10px; color: #999; text-align: right; margin-top: 4px; }
        .wa-sample-note {
          font-size: 11px; color: #64748B; margin-top: 12px; font-style: italic;
        }
      `}</style>
    </div>
  );
}
