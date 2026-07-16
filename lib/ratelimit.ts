// Minimal in-memory throttle to stop a visitor spamming real (paid) calls.
// Not distributed-perfect across serverless instances, but on Vercel Fluid
// Compute instances are reused, so it meaningfully rate-limits a demo page.
// For production, back this with Upstash/Vercel KV.

const WINDOW_MS = 20_000; // one call per key per 20s
const lastCall = new Map<string, number>();

export function throttle(key: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const prev = lastCall.get(key);
  if (prev && now - prev < WINDOW_MS) {
    return { ok: false, retryAfterMs: WINDOW_MS - (now - prev) };
  }
  lastCall.set(key, now);
  // opportunistic cleanup
  if (lastCall.size > 500) {
    for (const [k, t] of lastCall) if (now - t > WINDOW_MS) lastCall.delete(k);
  }
  return { ok: true, retryAfterMs: 0 };
}
