import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";

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
