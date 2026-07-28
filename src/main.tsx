import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App.tsx';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import { initSentry } from './lib/sentry';
import { queryClient } from './lib/queryClient';
import './index.css';

// Init Sentry BEFORE createRoot so the SDK wraps React error handling from
// the start. No-op when VITE_SENTRY_DSN is absent (dormant mode).
initSentry();

// AppErrorBoundary intentionally cast to any because this project ships
// without @types/react and TS can't infer the `children` prop from React.Component.
// Runtime behaviour is unchanged.
const Boundary = AppErrorBoundary as any;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boundary>
        <App />
        <Toaster position="top-right" richColors closeButton />
      </Boundary>
    </QueryClientProvider>
  </StrictMode>,
);
