import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverRpc } from "@/lib/server-rpc";
import {
  ADMIN_COOKIE,
  SESSION_TTL_S,
  createSessionToken,
  sameOrigin,
  verifySessionToken,
} from "@/lib/admin-auth";
import {
  consumeWalletNonce,
  nonceBinding,
  walletRole,
  walletVerifyMessage,
} from "@/lib/admin-wallets";

export const dynamic = "force-dynamic";

// Step 2 of wallet verification: the connected wallet signs the nonce message;
// if the signature checks out and the wallet is allow-listed, the session
// cookie is reissued carrying { address, role }.
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
    signature?: string;
    nonce?: string;
  } | null;
  const address = body?.address?.trim() ?? "";
  const signature = body?.signature ?? "";
  const nonce = body?.nonce ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !signature || !nonce) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // One-time nonce bound to this exact session + address: replays, other
  // sessions, and address swaps all fail here before any crypto runs.
  if (!(await consumeWalletNonce(nonce, nonceBinding(address, token)))) {
    return NextResponse.json(
      { error: "Nonce expired — try again" },
      { status: 400 },
    );
  }

  // Public-client verifyMessage also validates ERC-1271/6492 smart-wallet
  // signatures (plain EOA signatures verify locally without an RPC call).
  const valid = await serverRpc()
    .verifyMessage({
      address: address as `0x${string}`,
      message: walletVerifyMessage(nonce),
      signature: signature as `0x${string}`,
    })
    .catch(() => false);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const role = await walletRole(address);
  if (!role) {
    return NextResponse.json(
      { error: "This wallet has no admin access" },
      { status: 403 },
    );
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(ADMIN_COOKIE, createSessionToken({ address, role }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return res;
}
