import { NextResponse } from "next/server";
import { getPublicAllowlist } from "@/lib/allowlist";
import { verifyConfigured } from "@/lib/verify";
import { demoEnabled } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns only MASKED numbers + labels so the UI can show which lead(s) it can
// call, without ever exposing a raw dialable number to the browser. `verify`
// tells the UI whether the "call my own number" (OTP) tab is available.
export function GET() {
  const numbers = getPublicAllowlist();
  const demo = demoEnabled();
  const verify = verifyConfigured();
  return NextResponse.json({
    provider: (process.env.VOICE_PROVIDER || "vapi").toLowerCase(),
    numbers,
    // The app can place a call if ANY dial path is available: an allowlisted
    // lead, demo mode (type any number), or OTP verify. Not just the allowlist.
    configured: numbers.length > 0 || demo || verify,
    verify,
    demo,
  });
}
