import { NextRequest, NextResponse } from "next/server";
import { resolveIndex, getAllowlist } from "@/lib/allowlist";
import { getProvider } from "@/lib/providers";
import { throttle } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/call
// Body: { index: number }  — an INDEX into the server-side allowlist.
// The browser NEVER sends a phone number. The server maps index -> number.
// A visitor therefore cannot make this app dial an arbitrary number.
export async function POST(req: NextRequest) {
  // 1. Config sanity
  if (getAllowlist().length === 0) {
    return NextResponse.json(
      { error: "Server not configured: ALLOWED_NUMBERS is empty." },
      { status: 500 },
    );
  }

  // 2. Rate-limit per client IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const t = throttle(ip);
  if (!t.ok) {
    return NextResponse.json(
      { error: "Too many calls. Please wait a moment.", retryAfterMs: t.retryAfterMs },
      { status: 429 },
    );
  }

  // 3. Parse + validate the index
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
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

  // 4. Place the call via the active provider
  try {
    const provider = getProvider();
    const { id } = await provider.placeCall(entry.number);
    return NextResponse.json({
      callId: id,
      provider: provider.name,
      to: entry.masked, // masked only
      label: entry.label,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to place call: ${message}` },
      { status: 502 },
    );
  }
}
