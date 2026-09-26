declare module '*.svg' {
  const value: string;
  export default value;
}

/** Raw SVG markup; both esbuild (`text` loader) and vitest resolve this to the file's source. */
declare module '*.svg?raw' {
  const value: string;
  export default value;
}
