/** Ambient types for Vite imports: `import.meta.glob`, `*?raw` text, `*.svg` URLs, and the build-time `__APP_VERSION__`. */
/// <reference types="vite/client" />
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const url: string;
  export default url;
}

declare const __APP_VERSION__: string;
