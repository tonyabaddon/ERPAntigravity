// src/components/errors/AppErrorBoundary.tsx
//
// Root-level React error boundary. Catches unhandled render errors so the
// whole app doesn't blank out on one component crash. Every FE deploy from
// 2026-07-18 forward should have this wrapping <App /> in main.tsx.
//
// Task 11 (2026-07-18): Reports to Sentry via captureException in
// componentDidCatch. Safe no-op when Sentry is not initialised (DSN absent).
import * as React from 'react';
import * as Sentry from '@sentry/react';
import { AlertTriangle } from 'lucide-react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  public state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] Uncaught render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    // Report to Sentry with component stack context.
    // Safe no-op when Sentry SDK is uninitialised (DSN absent in dormant mode).
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded shadow p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={28} />
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-slate-900">Terjadi kesalahan</h1>
              <p className="text-sm text-slate-600 mt-2">
                Aplikasi Caleo mengalami masalah tak terduga. Data Anda tetap aman
                — coba muat ulang halaman ini.
              </p>
              <details className="mt-4 text-xs text-slate-500">
                <summary className="cursor-pointer select-none">Detail teknis</summary>
                <pre className="mt-2 p-2 bg-slate-100 rounded overflow-auto max-h-48 whitespace-pre-wrap break-words">
                  {error.message}
                  {error.stack ? `\n\n${error.stack}` : ''}
                </pre>
              </details>
            </div>
          </div>
          <button
            onClick={this.handleReload}
            className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            data-testid="app-error-reload"
          >
            Muat ulang halaman
          </button>
          <p className="mt-3 text-xs text-slate-400 text-center">
            Jika masalah berlanjut, hubungi tim Caleo.
          </p>
        </div>
      </div>
    );
  }
}
