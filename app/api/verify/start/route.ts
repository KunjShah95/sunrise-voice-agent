import { NextRequest, NextResponse } from "next/server";
import {
  isValidE164,
  normalizeNumber,
  sendCode,
  verifyConfigured,
} from "@/lib/verify";
import { throttle } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/verify/start  Body: { number: string }
// Sends an SMS OTP so the caller can prove the number is theirs before we dial.
export async function POST(req: NextRequest) {
  if (!verifyConfigured()) {
    return NextResponse.json(
      { error: "Phone verification is not configured on the server." },
      { status: 500 },
    );
  }

  // Rate-limit code sends per IP (SMS costs money / can be abused).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const t = throttle(`verify:${ip}`);
  if (!t.ok) {
    return NextResponse.json(
      { error: "Please wait before requesting another code.", retryAfterMs: t.retryAfterMs },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const raw = (body as { number?: unknown })?.number;
  const number = normalizeNumber(typeof raw === "string" ? raw : "");

  if (!isValidE164(number)) {
    return NextResponse.json(
      { error: "Enter a valid phone number in international format, e.g. +919876543210." },
      { status: 400 },
    );
  }

  try {
    await sendCode(number);
    // Never echo the number back beyond what the user typed; just confirm.
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Could not send the code: ${message}` },
      { status: 502 },
    );
  }
}
