import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App.tsx';
import { AppErrorBoundary } from './components/errors/AppErrorBoundary';
import './index.css';

// AppErrorBoundary intentionally cast to any because this project ships
// without @types/react and TS can't infer the `children` prop from React.Component.
// Runtime behaviour is unchanged.
const Boundary = AppErrorBoundary as any;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </Boundary>
  </StrictMode>,
);
