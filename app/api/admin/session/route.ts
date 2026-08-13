import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { effectiveRole } from "@/lib/admin-wallets";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ isAdmin: false, role: "none", address: null });
  }
  const role = effectiveRole(session);
  return NextResponse.json({
    // Full dashboard access requires a wallet-verified role ("password"
    // sessions still need the wallet step — except the local-dev bypass,
    // where effectiveRole already reports "super").
    isAdmin: role === "admin" || role === "super",
    role,
    address: session.address ?? null,
  });
}
