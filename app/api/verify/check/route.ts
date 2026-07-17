import { NextRequest, NextResponse } from "next/server";
import {
  checkCode,
  isValidE164,
  normalizeNumber,
  verifyConfigured,
} from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/check  Body: { number: string, code: string }
// On a correct code, returns a single-use verifiedToken the browser hands to
// /api/call. The raw number is stored server-side only, keyed by that token.
export async function POST(req: NextRequest) {
  if (!verifyConfigured()) {
    return NextResponse.json(
      { error: "Phone verification is not configured on the server." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const rawNum = (body as { number?: unknown })?.number;
  const rawCode = (body as { code?: unknown })?.code;
  const number = normalizeNumber(typeof rawNum === "string" ? rawNum : "");
  const code = typeof rawCode === "string" ? rawCode.trim() : "";

  if (!isValidE164(number) || !/^\d{4,10}$/.test(code)) {
    return NextResponse.json(
      { error: "Enter the numeric code sent to your phone." },
      { status: 400 },
    );
  }

  try {
    const result = await checkCode(number, code);
    if (!result) {
      return NextResponse.json(
        { error: "That code is incorrect or expired. Try again." },
        { status: 401 },
      );
    }
    return NextResponse.json(result); // { verifiedToken, masked }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Verification failed: ${message}` },
      { status: 502 },
    );
  }
}
