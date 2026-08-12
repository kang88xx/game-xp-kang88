import { redirect } from "next/navigation";

// Route renamed /airdrop → /claim; keep old links working.
export default function AirdropRedirect() {
  redirect("/claim");
}
