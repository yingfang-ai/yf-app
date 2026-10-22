import { NextResponse } from "next/server";
import type { ToolSettingsResponse } from "@/lib/api-types";
import { isCodemodePreference, readCodemodePreference, writeCodemodePreference } from "@/lib/codemode-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { requireOperator } from "@/lib/yf/route-policy";

export const dynamic = "force-dynamic";

// The only writer of the global `defaultTools` key: the Code mode choice
// (ADR 0006), under the lock pi's SettingsManager takes on the same file.
// (The PowerShell switch is gone with the host shell, yingfang#28 R4.)

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

async function readToolSettings(): Promise<ToolSettingsResponse> {
  return { codemode: await readCodemodePreference() };
}

export async function GET(req: Request) {
  const denied = await requireOperator(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  const denied = await requireOperator(req);
  if (denied) return denied;

  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  const changes = body as { codemode?: unknown };
  if (!("codemode" in changes)) {
    return NextResponse.json({ error: "Send codemode" }, { status: 400 });
  }

  if (!isCodemodePreference(changes.codemode)) {
    return NextResponse.json({ error: "codemode must be \"automatic\" or \"always\"" }, { status: 400 });
  }
  try {
    await writeCodemodePreference(changes.codemode);
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}
