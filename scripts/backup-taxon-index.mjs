// Snapshot the current public.taxon_index to a timestamped file BEFORE overwriting it
// with a new guess index. Reference data (no user rows), but --replace is destructive,
// so keep a restore point. Needs the service-role key (RLS hides the table otherwise).
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-taxon-index.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("taxon_index").select("*").range(from, from + 999);
  if (error) { console.error("read failed:", error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const out = resolve(ROOT, `taxon_index.backup.${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(rows));
console.log(`✓ backed up ${rows.length} rows → ${out}`);
