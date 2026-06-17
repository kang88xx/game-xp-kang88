import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  clearRateLimit,
  clientIp,
  rateLimitLogin,
  sameOrigin,
  verifyPassword,
  verifySessionToken,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Re-authentication for destructive admin actions (delete token/pool/
// campaign): requires BOTH a valid admin session and the password again.
// Shares the login rate limiter so brute-forcing here is throttled too.
export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ip = clientIp(req);
  if (!(await rateLimitLogin(ip))) {
    return NextResponse.json(
      { error: "Too many attempts — try again in 10 minutes" },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    password?: string;
  } | null;
  if (!body?.password || !verifyPassword(body.password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  await clearRateLimit(ip);
  return NextResponse.json({ ok: true });
}
