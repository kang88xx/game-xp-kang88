import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, sameOrigin, verifySessionToken } from "@/lib/admin-auth";
import { createWalletNonce, walletVerifyMessage } from "@/lib/admin-wallets";

export const dynamic = "force-dynamic";

// Step 1 of wallet verification: hand a password-unlocked session a one-time
// nonce + the exact message to sign with the connected wallet.
export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const nonce = await createWalletNonce();
  return NextResponse.json({ nonce, message: walletVerifyMessage(nonce) });
}
