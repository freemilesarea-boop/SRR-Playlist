// AI-MUSIC-10 — tiny deterministic FNV-1a hash for redaction. Used to publish a stable, non-reversible hash of a
// track id (never the raw id/title/artist). No crypto, no clock, no randomness. Pure.
export function fnv1aHash(input: string | null | undefined): string | null {
  if (input == null || input === '') return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
