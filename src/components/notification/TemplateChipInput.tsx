// src/components/notification/TemplateChipInput.tsx
// Shared template editor with chip variable insertion at cursor position.
// Reused by Task 2.7 (PiutangWaReminderScreen) and Sprint 3 (universal editor).
import { useRef } from 'react';

interface Variable {
  key: string;    // e.g. 'customer_nama'
  label: string;  // e.g. 'Nama Customer'
}

interface TemplateChipInputProps {
  variables: Variable[];
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  maxChars?: number;
  placeholder?: string;
}

export function TemplateChipInput({
  variables,
  value,
  onChange,
  onBlur,
  maxChars = 700,
  placeholder = 'Ketik pesan reminder di sini...',
}: TemplateChipInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertVariable(varKey: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const token = `{${varKey}}`;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Move cursor after inserted token
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  const charCount = value.length;
  const charColor = charCount > 650 ? 'red' : charCount > 500 ? 'orange' : 'green';

  return (
    <div className="template-chip-input">
      <div className="chip-row" role="toolbar" aria-label="Sisipkan variabel">
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            className="chip"
            onClick={() => insertVariable(v.key)}
            aria-label={`Sisipkan ${v.label}`}
          >
            + {v.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        maxLength={maxChars + 50}
        rows={8}
        placeholder={placeholder}
        aria-label="Konten template"
      />
      <div className={`char-counter char-counter--${charColor}`}>
        {charCount}/{maxChars} karakter
        {charCount > maxChars && ' — pesan terlalu panjang, WhatsApp mungkin potong'}
      </div>
      <style>{`
        .chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .chip {
          background: #FFF7F0; border: 1px solid #FBBF24; color: #0B2545;
          padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
          cursor: pointer; transition: transform 0.15s;
        }
        .chip:hover { transform: translateY(-1px); }
        textarea {
          width: 100%; font-family: 'Inter', sans-serif; font-size: 14px;
          line-height: 1.55; padding: 12px; border: 1px solid #E2E8F0;
          border-radius: 8px; resize: vertical;
        }
        .char-counter { font-size: 12px; margin-top: 6px; }
        .char-counter--green { color: #166534; }
        .char-counter--orange { color: #92400E; }
        .char-counter--red { color: #991B1B; font-weight: 700; }
      `}</style>
    </div>
  );
}
