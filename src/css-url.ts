/**
 * Build a CSS `url()` value for an arbitrary vault resource path.
 *
 * Vault file names routinely contain spaces, parentheses and quotes
 * (`IMG_1234 (1).jpg`). An unquoted `url(...)` value ends at the first `)` and
 * silently drops the image, so always emit the quoted form and escape the two
 * characters that terminate or escape a CSS string.
 */
export function cssUrl(value: unknown): string {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // A raw newline terminates a CSS string token, so it has to be escaped too.
    .replace(/\r/g, '\\d ')
    .replace(/\n/g, '\\a ');
  return `url("${escaped}")`;
}
