// The debug globals main.js puts on window for the console and the probes (scripts/probe-*.mjs).
interface Window {
  app: any;
  runBenchmark: (frames?: number, options?: { shot?: string, warmup?: number }) => Promise<any>;
}

// Vite's import.meta.env (DEV, BASE_URL…): substituted at dev and build time
interface ImportMeta {
  readonly env: { readonly DEV?: boolean, readonly BASE_URL?: string, readonly [key: string]: any };
}
