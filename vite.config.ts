import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify – file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      globals: true,
      // Exclude git-worktrees kept under .claude/worktrees/ (gitignored).
      // These contain duplicate test files from feature branches that are not
      // part of main; vitest's default glob would recurse into them locally.
      //
      // Also exclude:
      // - tests/integration/**: hits live Supabase, requires SUPABASE_SERVICE_KEY,
      //   not runnable in Cloud Build free tier. Manual dev-only. Many have drift
      //   from post-hardening RLS. Run via: npx vitest run tests/integration/
      // - tests/isolation/**: same reason as integration/
      // - tests/e2e/**: Playwright (own runner), not vitest
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '.claude/**',
        'tests/integration/**',
        'tests/isolation/**',
        'tests/e2e/**',
        // Supabase edge functions use Deno runtime + https:// imports — not vitest.
        // Run via: cd supabase/functions/<fn> && deno test
        'supabase/functions/**',
      ],
    },
  };
});
