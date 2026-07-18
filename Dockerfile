# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite bakes env vars into the bundle at build time
ARG VITE_BACKEND_URL
ARG VITE_APP_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Sentry: DSN is public-safe. COMMIT_SHA identifies the release in Sentry.
# Both empty by default — no DSN means Sentry stays dormant.
ARG VITE_SENTRY_DSN
ARG VITE_COMMIT_SHA
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_COMMIT_SHA=$VITE_COMMIT_SHA

RUN npm run build
# Remove source maps so they don't ship in the serve image.
# 'hidden' sourcemaps (Task 11) produce .map files alongside the bundle —
# serve would serve them at predictable /assets/*.js.map URLs. The
# cloudbuild.frontend.yaml node:20 step runs its own build + uploads maps to
# Sentry before this Docker layer, so this delete only affects the image.
RUN find /app/dist -name '*.map' -delete

# Serve stage — Node reads $PORT from Cloud Run
FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

# Task 16 (2026-07-18): custom security headers served by 'serve'.
# `serve` picks up serve.json from the served directory (./dist).
COPY serve.json ./dist/serve.json

EXPOSE 8080

CMD sh -c "serve -s dist -l ${PORT:-8080}"
