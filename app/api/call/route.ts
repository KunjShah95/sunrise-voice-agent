import { NextRequest, NextResponse } from "next/server";
import { resolveIndex, getAllowlist } from "@/lib/allowlist";
import { getProvider } from "@/lib/providers";
import { throttle } from "@/lib/ratelimit";
import { consumeVerifiedToken, maskNumber, isValidE164, normalizeNumber } from "@/lib/verify";
import { demoEnabled } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/call
// Body is ONE of:
//   { index: number }          — an INDEX into the server-side allowlist, OR
//   { verifiedToken: string }  — a single-use token minted by /api/verify/check
//                                after the caller proved the number is theirs.
// In BOTH cases the browser NEVER sends a raw phone number. The server maps the
// index/token -> number. A visitor cannot make this app dial an arbitrary
// number: it's either an allowlisted lead or a number that passed OTP.
export async function POST(req: NextRequest) {
  // 1. Rate-limit per client IP (before any provider work)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const t = throttle(ip);
  if (!t.ok) {
    return NextResponse.json(
      { error: "Too many calls. Please wait a moment.", retryAfterMs: t.retryAfterMs },
      { status: 429 },
    );
  }

  // 3. Parse body and resolve to a dialable number by ONE of two paths.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const rawToken = (body as { verifiedToken?: unknown })?.verifiedToken;
  const rawNumber = (body as { number?: unknown })?.number;

  let number: string;
  let toMasked: string;
  let label: string;

  if (demoEnabled() && typeof rawNumber === "string" && rawNumber.trim()) {
    // Path 0 (DEMO ONLY): a number typed straight into the frontend. Gated by
    // DEMO_MODE so this is never live on a public deploy. Still E.164-validated
    // and IP rate-limited above.
    const n = normalizeNumber(rawNumber);
    if (!isValidE164(n)) {
      return NextResponse.json(
        { error: "Enter a valid phone number in international format, e.g. +919876543210." },
        { status: 400 },
      );
    }
    number = n;
    toMasked = maskNumber(n);
    label = "Demo number";
  } else if (typeof rawToken === "string" && rawToken) {
    // Path A: caller's own, OTP-verified number (single-use token).
    const verifiedNumber = consumeVerifiedToken(rawToken);
    if (!verifiedNumber) {
      return NextResponse.json(
        { error: "Your verification expired. Please verify your number again." },
        { status: 403 },
      );
    }
    number = verifiedNumber;
    toMasked = maskNumber(verifiedNumber);
    label = "Your number";
  } else {
    // Path B: an allowlisted lead selected by index.
    if (getAllowlist().length === 0) {
      return NextResponse.json(
        { error: "Server not configured: ALLOWED_NUMBERS is empty." },
        { status: 500 },
      );
    }
    const index = (body as { index?: unknown })?.index ?? 0;
    const entry = resolveIndex(typeof index === "number" ? index : Number(index));
    if (!entry) {
      // The one line that enforces the allowlist. No valid index => no call.
      return NextResponse.json(
        { error: "Requested number is not on the allowlist." },
        { status: 403 },
      );
    }
    number = entry.number;
    toMasked = entry.masked;
    label = entry.label;
  }

  // 4. Place the call via the active provider
  try {
    const provider = getProvider();
    const { id } = await provider.placeCall(number);
    return NextResponse.json({
      callId: id,
      provider: provider.name,
      to: toMasked, // masked only
      label,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to place call: ${message}` },
      { status: 502 },
    );
  }
}
