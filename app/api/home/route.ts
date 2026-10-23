import { NextResponse } from "next/server";
import { homedir } from "os";
import { requireOperator } from "@/lib/yf/route-policy";

export async function GET(req: Request) {
  const denied = await requireOperator(req);
  if (denied) return denied;
  return NextResponse.json({ home: homedir() });
}
