import { NextResponse } from "next/server";
import { getPublicAllowlist } from "@/lib/allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns only MASKED numbers + labels so the UI can show which lead(s) it can
// call, without ever exposing a raw dialable number to the browser.
export function GET() {
  const numbers = getPublicAllowlist();
  return NextResponse.json({
    provider: (process.env.VOICE_PROVIDER || "vapi").toLowerCase(),
    numbers,
    configured: numbers.length > 0,
  });
}
