import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { visitorDays } from "@/lib/analytics-store";

export const dynamic = "force-dynamic";

// Daily visitor log as a standalone HTML page — opened in a new tab from the
// admin "Detail" button. Admin only. Shows date + visitor count, groupable by
// day / week / month (client-side, from the embedded daily data).
export async function GET() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const days = await visitorDays(); // [{ date: "2026-06-10", count: 3 }, ...] newest first
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const data = JSON.stringify(days);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Visitor Records (${total})</title>
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
  .tabs { display: inline-flex; gap: 4px; margin-bottom: 20px; padding: 4px;
    background: #11151f; border: 1px solid #232838; border-radius: 999px; }
  .tabs button {
    appearance: none; border: 0; cursor: pointer; padding: 6px 16px;
    border-radius: 999px; font: inherit; font-size: 13px; font-weight: 600;
    color: #8a91a0; background: transparent; transition: .15s;
  }
  .tabs button.active { background: #6366f1; color: #fff; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead th {
    text-align: left; font-size: 12px; font-weight: 600; color: #8a91a0;
    padding: 10px 12px; border-bottom: 1px solid #232838;
  }
  thead th.num, tbody td.num { text-align: right; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #161b27; }
  tbody tr:hover { background: #11151f; }
  td.cnt { font-weight: 600; }
  td.empty { text-align: center; color: #6b7384; padding: 40px 12px; }
</style>
</head>
<body>
  <h1>Visitor Records</h1>
  <p class="sub">Total ${total.toLocaleString()} cumulative visitors · Dates in KST</p>
  <div class="tabs">
    <button data-mode="day" class="active">Daily</button>
    <button data-mode="week">Weekly</button>
    <button data-mode="month">Monthly</button>
  </div>
  <table>
    <thead><tr><th id="th-label">Date</th><th class="num">Visitors</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
<script>
  var DAYS = ${data}; // [{date:"YYYY-MM-DD", count:N}] newest first

  // Monday-based ISO-ish week key: returns the Monday date of that week (KST).
  function weekStart(dateStr) {
    var p = dateStr.split("-");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }

  function group(mode) {
    if (mode === "day") {
      return DAYS.map(function (d) { return { label: d.date, count: d.count }; });
    }
    var map = {};
    DAYS.forEach(function (d) {
      var key = mode === "month" ? d.date.slice(0, 7) : weekStart(d.date);
      map[key] = (map[key] || 0) + d.count;
    });
    return Object.keys(map)
      .sort(function (a, b) { return b.localeCompare(a); })
      .map(function (k) {
        return { label: mode === "week" ? k + " week" : k, count: map[k] };
      });
  }

  function render(mode) {
    document.getElementById("th-label").textContent =
      mode === "week" ? "Week Start" : mode === "month" ? "Month" : "Date";
    var rows = group(mode);
    var body = document.getElementById("rows");
    if (!rows.length) {
      body.innerHTML = '<tr><td class="empty" colspan="2">No visitor records yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(function (r) {
        return "<tr><td>" + r.label + '</td><td class="num cnt">' +
          r.count.toLocaleString() + "</td></tr>";
      })
      .join("");
  }

  var btns = document.querySelectorAll(".tabs button");
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      btns.forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      render(b.getAttribute("data-mode"));
    });
  });
  render("day");
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
