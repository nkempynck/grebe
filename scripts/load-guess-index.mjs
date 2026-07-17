// Load the generated out-of-set guess index into public.taxon_index.
//
// Run AFTER applying supabase/taxon_index.sql and generating the index with
// scripts/build-guess-index.mjs. Uses the service-role key (bypasses RLS).
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-guess-index.mjs
//
// Idempotent: upserts by ott_id, and (with --replace) first clears rows no longer
// in the generated file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "src/data/guessIndex.generated.json");

// Must match normalizeName() in src/core/resolve.ts (queries are normalized the
// same way client-side before hitting search_taxa).
const normalizeName = (s) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  // Guard against the #1 mistake: pasting the anon key. Only the service_role key
  // bypasses RLS, which the write path relies on. Decode the JWT role claim (or
  // sniff the new-style key prefix) and bail early with a clear message.
  const jwtRole = (k) => {
    try {
      const parts = k.split(".");
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).role ?? null;
    } catch { return null; }
  };
  const role = jwtRole(key);
  if (key.startsWith("sb_publishable_") || role === "anon") {
    console.error("That looks like the ANON / publishable key. Use the SERVICE_ROLE secret");
    console.error("(Supabase → Project Settings → API → service_role, or the sb_secret_… key).");
    process.exit(1);
  }
  if (role && role !== "service_role") {
    console.error(`Key role is "${role}", not "service_role" — writes will hit RLS. Use the service_role secret.`);
    process.exit(1);
  }
  const replace = process.argv.includes("--replace");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { entries } = JSON.parse(readFileSync(SRC, "utf8"));
  // Dedupe by ott_id: two different source names can resolve (via TNRS) to the
  // same OTT taxon, and a batch upsert can't touch the same primary key twice.
  const byId = new Map();
  for (const e of entries) {
    if (byId.has(e.graft.id)) continue;
    byId.set(e.graft.id, {
      ott_id: e.graft.id,
      sci_name: e.graft.sciName,
      common: e.graft.common ?? null,
      rank: e.graft.rank ?? null,
      name_norm: normalizeName(e.graft.sciName),
      common_norm: e.graft.common ? normalizeName(e.graft.common) : null,
      lineage: e.graft.lineage,
    });
  }
  const rows = [...byId.values()];
  const dupes = entries.length - rows.length;
  console.log(`loading ${rows.length} taxa → taxon_index${dupes ? ` (${dupes} duplicate ott_id dropped)` : ""}`);

  if (replace) {
    const keep = rows.map((r) => r.ott_id);
    const { error } = await db.from("taxon_index").delete().not("ott_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
    if (error) console.warn("prune warning:", error.message);
  }

  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from("taxon_index").upsert(chunk, { onConflict: "ott_id" });
    if (error) { console.error("upsert failed:", error.message); process.exit(1); }
    done += chunk.length;
    console.log(`  upserted ${done}/${rows.length}`);
  }

  const { count } = await db.from("taxon_index").select("*", { count: "exact", head: true });
  console.log(`done. taxon_index now holds ${count} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
