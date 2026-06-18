/// <reference types="vite/client" />

// Minimal JSX shim so TypeScript recognises `key` as a valid JSX attribute
// without requiring @types/react.  React 19 ships no bundled .d.ts files.
declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number | null | undefined;
  }
}
