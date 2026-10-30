/** Ambient types for the Vite imports the package uses: `import.meta.glob` and `*?raw` text. */
/// <reference types="vite/client" />
declare module '*?raw' {
  const content: string;
  export default content;
}
