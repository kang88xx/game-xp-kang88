import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, sameOrigin, verifySessionToken } from "@/lib/admin-auth";
import {
  createWalletNonce,
  nonceBinding,
  walletVerifyMessage,
} from "@/lib/admin-wallets";

export const dynamic = "force-dynamic";

// Step 1 of wallet verification: hand a password-unlocked session a one-time
// nonce (bound to this session + the wallet address that will sign) plus the
// exact message to sign.
export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !verifySessionToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    address?: string;
  } | null;
  const address = body?.address?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const nonce = await createWalletNonce(nonceBinding(address, token));
  return NextResponse.json({ nonce, message: walletVerifyMessage(nonce) });
}
