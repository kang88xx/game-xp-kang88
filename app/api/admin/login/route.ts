import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  clearRateLimit,
  clientIp,
  createSessionToken,
  rateLimitLogin,
  sameOrigin,
  SESSION_TTL_S,
  verifyPassword,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "Admin login is not configured on this server" },
      { status: 503 },
    );
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
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return res;
}
