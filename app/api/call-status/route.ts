import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/call-status?id=<callId>
// The browser polls this. We fetch call state from the provider server-side
// (key stays on the server) and return normalized status + transcript +
// extracted qualification fields + cost in rupees.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const provider = getProvider();
    const call = await provider.getCall(id);
    return NextResponse.json(call);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch call: ${message}` },
      { status: 502 },
    );
  }
}
