import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { normalizeBolnaExecution } from "@/lib/providers/bolna";
import { cacheCall } from "@/lib/callCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/bolna-webhook
// Bolna posts the finished execution here the moment a call completes
// (transcript + extracted_data + telephony_data.recording_url + total_cost).
// We normalize it and stash it in the process cache so /api/call-status and
// /api/transcript can serve the finalized result instantly — no polling race.
//
// Configure in the Bolna dashboard: Agent → Webhook URL = https://<host>/api/bolna-webhook
// If BOLNA_WEBHOOK_SECRET is set, append ?secret=<value> to that URL (or send
// it as an x-webhook-secret header). Unset = no auth (dev only).

function authorized(req: NextRequest): boolean {
  const expected = process.env.BOLNA_WEBHOOK_SECRET;
  if (!expected) return true; // no secret configured -> skip check (dev)
  const provided =
    req.headers.get("x-webhook-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Bolna may wrap the execution under `data`/`execution`, or send it flat.
  const exec = body?.data ?? body?.execution ?? body;
  const id = exec?.id ?? exec?.execution_id ?? body?.execution_id;
  if (!id) {
    return NextResponse.json({ error: "No execution id in payload" }, { status: 400 });
  }

  try {
    const call = normalizeBolnaExecution(exec, String(id));
    await cacheCall(call);
    return NextResponse.json({ ok: true, id: call.id, status: call.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Normalize failed: ${message}` }, { status: 500 });
  }
}
