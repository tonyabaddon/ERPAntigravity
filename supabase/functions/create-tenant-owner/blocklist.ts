// Slug format: 3-30 chars, lowercase alphanumeric + dash, must start with letter or digit
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;

export const RESERVED_SLUGS: string[] = [
  'admin', 'api', 'auth', 'login', 'logout', 'register', 'signup', 'signin',
  'www', 'mail', 'blog', 'docs', 'help', 'support', 'settings', 'pengaturan',
  't', 'select-tenant', 'onboarding', 'billing',
];
