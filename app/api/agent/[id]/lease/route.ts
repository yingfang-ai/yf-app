import { NextResponse } from "next/server";
import { renewSessionLivenessLeases } from "@/lib/session-liveness";
import { requireSessionAccess } from "@/lib/yf/session-access";

// POST /api/agent/[id]/lease - Renew selected-session SSE leases.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccess(_req, id);
  if (denied) return denied;
  return NextResponse.json({
    success: true,
    renewed: renewSessionLivenessLeases(id),
  }, { headers: { "Cache-Control": "no-store" } });
}
