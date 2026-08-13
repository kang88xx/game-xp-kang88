import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, sameOrigin, verifySessionToken } from "@/lib/admin-auth";
import {
  addAdminWallet,
  listAdminWallets,
  removeAdminWallet,
  sessionRole,
  superAdmins,
} from "@/lib/admin-wallets";

export const dynamic = "force-dynamic";

async function session() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Admin wallet roster — any valid admin session can read it. */
export async function GET() {
  const s = await session();
  if (!s) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    supers: superAdmins(),
    admins: await listAdminWallets(),
    // Role re-derived from the current allow-list, not the 24h cookie.
    role: await sessionRole(s),
    address: s.address ?? null,
  });
}

/** Add a regular admin wallet — super admins only. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const s = await session();
  if (!s) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if ((await sessionRole(s)) !== "super") {
    return NextResponse.json(
      { error: "Only super admins can add admin wallets" },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    address?: string;
  } | null;
  const address = body?.address?.trim() ?? "";
  if (!(await addAdminWallet(address))) {
    return NextResponse.json(
      { error: "Invalid address (or already a super admin)" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, admins: await listAdminWallets() });
}

/** Remove a regular admin wallet — super admins only. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const s = await session();
  if (!s) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if ((await sessionRole(s)) !== "super") {
    return NextResponse.json(
      { error: "Only super admins can remove admin wallets" },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    address?: string;
  } | null;
  const address = body?.address?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await removeAdminWallet(address);
  return NextResponse.json({ ok: true, admins: await listAdminWallets() });
}
