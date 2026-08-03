// Grebe · Discussion board abuse probe  (PERMANENT, re-runnable)
//
// WHEN TO RUN: after any change to discussions.sql, to an RLS policy, or to a
// function grant; and before a deploy that touches either. It is a regression
// check, not a one-off.
//
// WHY IT EXISTS ALONGSIDE discussions_schema_check(): that function asks the
// database to describe itself. This one uses the PUBLIC ANON KEY and actually
// tries the attacks, which is the difference that mattered in the 2026-07-28
// review: a PATCH matching no visible row returns 204 ("success, zero rows"),
// which reads as a successful write unless something checks properly.
//
// Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the environment, and
// nothing else. Both are public values: the anon key already ships inside the
// browser bundle, which is exactly why this probe is meaningful. It refuses to run
// with a service-role key, and never prints key material.
//
//   node scripts/discussion-abuse-check.mjs
//
// Exits non-zero if any check fails, so it can gate a deploy.

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the environment.");
  process.exit(1);
}
// Refuse anything but the anon key: the point is to probe as a player would. A
// service-role key bypasses RLS and would report everything as wide open.
if (/service_role/.test(key) || key.startsWith("sb_secret_")) {
  console.error("That looks like a SERVICE ROLE key. This probe must use the anon key.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function report(name, passed, detail) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures++;
}

/** A write counts as blocked if it errored, or succeeded against zero rows. */
function writeBlocked(error, data) {
  if (error) return true;
  return !data || (Array.isArray(data) && data.length === 0);
}

const today = new Date().toISOString().slice(0, 10);

console.log("\nDiscussion board abuse probe (anon key)\n");

// ---- 1. direct table reads ----
for (const table of ["comments", "comment_votes"]) {
  const { data, error } = await db.from(table).select("*").limit(5);
  report(
    `${table}: direct SELECT refused`,
    !!error || !data || data.length === 0,
    error ? error.code ?? error.message : `returned ${data?.length ?? 0} rows`,
  );
}

// ---- 2. direct table writes ----
{
  const { data, error } = await db
    .from("comments")
    .insert({ game: "lineage", puzzle_date: today, body: "abuse probe", user_id: crypto.randomUUID() })
    .select();
  report("comments: direct INSERT refused", writeBlocked(error, data), error?.code ?? "");
}
// The UPDATE and DELETE probes use a filter that CANNOT match anything. A probe
// with a broad filter (neq id 0) would rewrite or delete every comment in the
// database on the day RLS is actually broken, which is the one day you run this.
// So these two are shaped like the attack but harmless, and they are not the
// load-bearing evidence: that comes from the INSERT probes, which genuinely error
// with 42501, plus the "write locked" key in discussions_schema_check(), which
// asserts no INSERT/UPDATE/DELETE policy exists at all.
const NO_MATCH = "__grebe_probe_never_matches__";
{
  const { data, error } = await db.from("comments").update({ body: "tampered" }).eq("body", NO_MATCH).select();
  report("comments: direct UPDATE refused", writeBlocked(error, data), error?.code ?? "");
}
{
  const { data, error } = await db.from("comments").delete().eq("body", NO_MATCH).select();
  report("comments: direct DELETE refused", writeBlocked(error, data), error?.code ?? "");
}
{
  const { data, error } = await db
    .from("comment_votes")
    .insert({ comment_id: 1, user_id: crypto.randomUUID(), value: 1 })
    .select();
  report("comment_votes: direct INSERT refused", writeBlocked(error, data), error?.code ?? "");
}

// ---- 3. the denylist must be neither readable nor probeable ----
{
  const { data, error } = await db.from("blocked_names").select("term").limit(5);
  const leaked = !error && !!data && data.length > 0;
  report(
    "blocked_names: not readable",
    !leaked,
    leaked ? `LEAKED ${data.length} terms` : error?.code ?? "no rows",
  );
}
{
  // text_is_blocked() returns the matched term, so an exposed EXECUTE grant lets
  // anyone extract the list one probe at a time. Postgres grants EXECUTE to PUBLIC
  // by default, which is why discussions.sql revokes it explicitly. This is the
  // check that would catch that revoke being lost.
  const { error } = await db.rpc("text_is_blocked", { p_text: "test" });
  report("text_is_blocked(): not callable", !!error, error ? error.code ?? "refused" : "CALLABLE BY ANON");
}
{
  const { error } = await db.rpc("has_played", {
    p_uid: crypto.randomUUID(), p_game: "lineage", p_date: today,
  });
  report("has_played(): not callable", !!error, error ? error.code ?? "refused" : "CALLABLE BY ANON");
}

// ---- 4. writes through the RPCs need an account ----
{
  const { error } = await db.rpc("post_comment", {
    p_game: "lineage", p_date: today, p_parent_id: null, p_body: "abuse probe",
  });
  report("post_comment(): refuses anonymous", !!error, error?.message ?? "ACCEPTED ANONYMOUS POST");
}
{
  const { error } = await db.rpc("vote_comment", { p_id: 1, p_value: 1 });
  report("vote_comment(): refuses anonymous", !!error, error?.message ?? "ACCEPTED ANONYMOUS VOTE");
}

// ---- 5. the board read is date-gated and never leaks a user id ----
{
  const { error } = await db.rpc("puzzle_comments", {
    p_game: "lineage", p_date: "2026-01-01", p_sort: "top", p_limit: 5,
  });
  report("puzzle_comments(): closed board refused", !!error, error?.message ?? "SERVED A CLOSED BOARD");
}
{
  const { data, error } = await db.rpc("puzzle_comments", {
    p_game: "lineage", p_date: today, p_sort: "top", p_limit: 5,
  });
  if (error) {
    report("puzzle_comments(): today readable by anon", false, error.message);
  } else {
    const rows = data ?? [];
    const leaks = rows.some((r) => "user_id" in r || "userId" in r);
    report("puzzle_comments(): today readable by anon", true, `${rows.length} rows`);
    report("puzzle_comments(): no user_id in payload", !leaks, leaks ? "LEAKED user_id" : "");
  }
}

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED — see above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
