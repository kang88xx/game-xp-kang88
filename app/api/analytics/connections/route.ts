import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { connectionLog } from "@/lib/analytics-store";

export const dynamic = "force-dynamic";

/** KST (UTC+9) date + time parts for a unix-ms timestamp. */
function kstParts(ts: number): { date: string; time: string } {
  const iso = new Date(ts + 9 * 60 * 60 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

// New-wallet connection log as a standalone HTML page — opened in a new tab
// from the admin "Detail" button. Admin only. Collects nothing but the wallet
// address and the time it first connected.
export async function GET() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const log = await connectionLog();
  const rows =
    log.length === 0
      ? `<tr><td colspan="4" class="empty">No wallets connected yet.</td></tr>`
      : log
          .map((c, i) => {
            const { date, time } = kstParts(c.ts);
            return `<tr>
              <td class="num">${log.length - i}</td>
              <td>${date}</td>
              <td>${time}</td>
              <td class="addr">${c.address}</td>
            </tr>`;
          })
          .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Wallet Connections (${log.length})</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b0d12; color: #e7e9ee;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; color: #8a91a0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead th {
    text-align: left; font-size: 12px; font-weight: 600; color: #8a91a0;
    padding: 10px 12px; border-bottom: 1px solid #232838;
  }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #161b27; }
  tbody tr:hover { background: #11151f; }
  td.num { color: #6b7384; width: 48px; }
  td.addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  td.empty { text-align: center; color: #6b7384; padding: 40px 12px; }
</style>
</head>
<body>
  <h1>Wallet Connections</h1>
  <p class="sub">Total ${log.length} · New wallets only · Time in KST</p>
  <table>
    <thead>
      <tr><th>#</th><th>Date</th><th>Time</th><th>Wallet Address</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
