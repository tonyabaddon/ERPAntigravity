// src/components/errors/ImpersonateFailureScreen.tsx
//
// Renders the correct error screen when an impersonation preflight fails.
// Platform admins see AccessDenied (they navigated to a wrong/forbidden tenant).
// Regular tenant users see TenantBootstrapError (their own tenant is broken).
//
// Extracted as a standalone component so it can be unit-tested in isolation
// without mounting the full App tree.

import React from 'react';
import * as Sentry from '@sentry/react';
import { AccessDenied } from './AccessDenied';
import { TenantBootstrapError } from './TenantBootstrapError';

interface Props {
  /** JWT is_platform_admin claim — true when the failing user is a platform admin. */
  isPlatformAdmin: boolean;
  /** Raw error message from the failed impersonation RPC call. */
  error: string;
  /** Called when the user wants to retry (reload). Used by TenantBootstrapError path. */
  onRetry: () => void;
  /** Called when the user wants to log out. Used by AccessDenied path. */
  onLogout: () => void;
}

export const ImpersonateFailureScreen: React.FC<Props> = ({
  isPlatformAdmin,
  error,
  onRetry,
  onLogout,
}) => {
  const errorClass = isPlatformAdmin ? 'impersonate' : 'tenant_bootstrap';
  Sentry.setTag('error_class', errorClass);

  if (isPlatformAdmin) {
    return <AccessDenied onLogout={onLogout} />;
  }

  return (
    <TenantBootstrapError
      code={`IMPERSONATE_FAILED: ${error || 'unknown'}`}
      onRetry={onRetry}
    />
  );
};
