// Server-side allowlist. The ONLY numbers this app may ever dial.
//
// Security model: the browser never sends a phone number. It sends an INDEX
// into this list. The server resolves index -> number. Therefore it is
// structurally impossible for a visitor to make the app dial an arbitrary
// number — the worst they can do is pick a different allowlisted lead.

export interface AllowlistEntry {
  index: number;
  number: string; // E.164, e.g. +9198...  — SERVER ONLY, never sent to client
  label: string;
  masked: string; // safe to show in UI, e.g. +91 98****4321
}

function normalize(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function mask(num: string): string {
  if (num.length <= 6) return num;
  const head = num.slice(0, 5); // +9198
  const tail = num.slice(-4);
  return `${head}${"*".repeat(Math.max(0, num.length - 9))}${tail}`;
}

export function getAllowlist(): AllowlistEntry[] {
  const numbers = (process.env.ALLOWED_NUMBERS || "")
    .split(",")
    .map(normalize)
    .filter(Boolean);

  const labels = (process.env.ALLOWED_LABELS || "")
    .split(",")
    .map((s) => s.trim());

  return numbers.map((number, index) => ({
    index,
    number,
    label: labels[index] || `Lead #${index + 1}`,
    masked: mask(number),
  }));
}

/** Public view — safe to send to the browser (no raw numbers). */
export function getPublicAllowlist() {
  return getAllowlist().map(({ index, label, masked }) => ({
    index,
    label,
    masked,
  }));
}

/** Resolve a client-supplied index to a real number. Returns null if invalid. */
export function resolveIndex(index: unknown): AllowlistEntry | null {
  const list = getAllowlist();
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= list.length) return null;
  return list[index];
}
