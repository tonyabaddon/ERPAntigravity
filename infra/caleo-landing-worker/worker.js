// Caleo Landing Worker — serves public/ with security headers per spec §5.5.
// Phase 3.0 (pure static). Phase 3.1 will add `connect-src <backend>` to CSP.
//
// Note: Cloudflare Assets (run_worker_first = true) handles extensionless URL
// routing natively — e.g. /case-study serves case-study.html, / serves
// index.html. Explicit .html rewrites would create redirect loops.

const CSP = [
  "default-src 'self'",
  // static.cloudflareinsights.com: Cloudflare auto-injects Web Analytics beacon on zones with Analytics enabled.
  // Whitelisting it here prevents the CSP violation + console error (which Lighthouse penalizes).
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https://www.google.com https://maps.google.com",
  "frame-src https://www.google.com",
  // cloudflareinsights.com endpoint that the beacon posts to.
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report",
].join("; ");

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": CSP,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Fetch from assets binding.
    // ASSETS handles extensionless routes and default documents natively:
    //   / → index.html, /case-study → case-study.html, etc.
    const response = await env.ASSETS.fetch(request);

    // Clone response so we can mutate headers.
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      newHeaders.set(key, value);
    }

    // Correct content-type for sitemap.xml (Cloudflare Assets may serve as octet-stream).
    if (pathname.endsWith(".xml")) {
      newHeaders.set("Content-Type", "application/xml; charset=utf-8");
    }
    if (pathname.endsWith(".txt")) {
      newHeaders.set("Content-Type", "text/plain; charset=utf-8");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
