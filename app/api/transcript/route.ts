import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import { getCachedCall } from "@/lib/callCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/transcript?executionId=<id>
// Fetch Bolna transcript by execution ID directly (useful for retrieving past calls)
export async function GET(req: NextRequest) {
  const executionId = req.nextUrl.searchParams.get("executionId");
  if (!executionId) {
    return NextResponse.json({ error: "Missing executionId parameter" }, { status: 400 });
  }

  try {
    // Prefer the webhook-pushed finalized execution if we have it cached.
    const cached = await getCachedCall(executionId);
    if (cached) return NextResponse.json(cached);

    const provider = getProvider();
    const call = await provider.getCall(executionId);
    return NextResponse.json(call);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch transcript: ${message}` },
      { status: 502 },
    );
  }
}
