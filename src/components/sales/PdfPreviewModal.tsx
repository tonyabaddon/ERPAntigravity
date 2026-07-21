import { useEffect, useMemo, useState } from 'react';
import { captureError } from '../../lib/captureError';

interface Props {
  blob: Blob;
  filename: string;
  onClose: () => void;
}

/**
 * Reusable PDF preview overlay. Takes a pre-generated PDF Blob + filename,
 * mounts an iframe pointed at an object URL, and offers Download / Tutup
 * actions. The object URL is created once via useMemo and revoked on unmount
 * so consumers don't leak memory if they reopen the modal many times.
 */
export function PdfPreviewModal({ blob, filename, onClose }: Props) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const [iframeError, setIframeError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleDownload() {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      captureError(err, { feature: 'sales', action: 'pdf_download' });
      setIframeError('Gagal download. Coba lagi.');
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300, padding: 16, backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', width: '80%', maxWidth: 960, maxHeight: '92vh',
        }}
      >
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5eeff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>Pratinjau PDF</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{filename}</div>
          </div>
          <button onClick={onClose} aria-label="Tutup" style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', background: '#f3f4f6', minHeight: '50vh' }}>
          <iframe
            title={`Pratinjau ${filename}`}
            src={url}
            style={{ width: '100%', height: '70vh', border: 'none', display: 'block', background: 'white' }}
            onError={() => setIframeError('Browser tidak bisa preview PDF. Klik Download.')}
          />
        </div>
        {iframeError && (
          <div style={{ padding: '8px 20px', fontSize: 12, color: '#b91c1c', background: '#fef2f2', borderTop: '1px solid #fecaca' }}>
            {iframeError}
          </div>
        )}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5eeff', display: 'flex', gap: 12, justifyContent: 'flex-end', background: '#fafbff' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white', color: '#374151', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            Tutup
          </button>
          <button
            onClick={handleDownload}
            style={{ padding: '8px 18px', borderRadius: 10, background: 'var(--color-primary)', color: 'white', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            ⬇ Download
          </button>
        </div>
      </div>
    </div>
  );
}
