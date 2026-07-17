// Phone-ownership verification via Twilio Verify (OTP), plus a short-lived
// server-side store of numbers that have proven ownership this session.
//
// WHY THIS EXISTS — security model:
// The rest of the app never lets the browser send a raw dialable number; it
// sends an INDEX into a server allowlist. The "call my own number" feature
// would break that if we simply dialed whatever the browser typed. Instead:
//
//   1. Browser sends a number to /api/verify/start  -> we SMS a code.
//   2. Browser sends the code to /api/verify/check  -> Twilio confirms it.
//   3. ONLY on success do we mint a random `verifiedToken` that maps, server
//      side, to that number. The browser gets the TOKEN, never keeps proving
//      the number.
//   4. /api/call accepts the token, resolves it to the number, and dials.
//
// Net effect: the app still only ever dials a number that has cryptographically
// (well, via OTP) proven it belongs to the person holding this browser. A
// visitor cannot make it ring an arbitrary stranger — matching the consent
// posture the allowlist gives, but for user-supplied numbers.

import { randomBytes } from "crypto";

const TWILIO_BASE = "https://verify.twilio.com/v2";

// ---- verified-number store (in-memory, like lib/ratelimit.ts) --------------
// Fine for a demo on reused Fluid Compute instances. For production, back with
// Upstash/Vercel KV so it survives across instances.
interface VerifiedEntry {
  number: string; // E.164, SERVER ONLY
  expires: number;
}
const verified = new Map<string, VerifiedEntry>();
const TOKEN_TTL_MS = 10 * 60 * 1000; // token valid 10 min, single call

export function isValidE164(raw: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(raw);
}

/** Normalize loose user input ("+91 98xxx", "0098...") to strict E.164-ish. */
export function normalizeNumber(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export function verifyConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const token = process.env.TWILIO_AUTH_TOKEN as string;
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

function serviceSid(): string {
  return process.env.TWILIO_VERIFY_SERVICE_SID as string;
}

/** Send an SMS OTP to the number. Throws on Twilio error. */
export async function sendCode(number: string): Promise<void> {
  const res = await fetch(
    `${TWILIO_BASE}/Services/${serviceSid()}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: number, Channel: "sms" }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${body}`);
  }
}

/**
 * Check a code. On success, mint + store a single-use verifiedToken and return
 * it (with a masked number for display). Returns null if the code is wrong.
 */
export async function checkCode(
  number: string,
  code: string,
): Promise<{ verifiedToken: string; masked: string } | null> {
  const res = await fetch(
    `${TWILIO_BASE}/Services/${serviceSid()}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: number, Code: code }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twilio check failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { status?: string };
  if (data.status !== "approved") return null;

  const token = randomBytes(24).toString("hex");
  verified.set(token, { number, expires: Date.now() + TOKEN_TTL_MS });
  cleanup();
  return { verifiedToken: token, masked: maskNumber(number) };
}

/**
 * Resolve a token to its verified number, consuming it (single use). Returns
 * null if unknown/expired. Called only by /api/call.
 */
export function consumeVerifiedToken(token: unknown): string | null {
  if (typeof token !== "string" || !token) return null;
  const entry = verified.get(token);
  if (!entry) return null;
  verified.delete(token); // single use
  if (Date.now() > entry.expires) return null;
  return entry.number;
}

export function maskNumber(num: string): string {
  if (num.length <= 6) return num;
  const head = num.slice(0, 5);
  const tail = num.slice(-4);
  return `${head}${"*".repeat(Math.max(0, num.length - 9))}${tail}`;
}

function cleanup(): void {
  if (verified.size <= 500) return;
  const now = Date.now();
  for (const [k, v] of verified) if (now > v.expires) verified.delete(k);
}
