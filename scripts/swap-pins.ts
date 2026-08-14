// Swap the pinned puzzles of two FUTURE dates for one game.
//
// Why this exists: a puzzle is a pure function of its date, so there is no "give me a
// different board for the 19th" — re-pinning a date just recomputes the same board. The
// only way to move a board off a date is to trade it with another date.
//
// The case it was written for: changing the generator under existing pins creates a SEAM.
// The anti-repeat replay rebuilds history by regenerating from the anchor with the NEW
// code, so it remembers a past that never happened and cannot see the boards players
// actually played under the OLD pins. Measured across the 2026-08-14 switchover, that let
// exactly one board through — 2026-09-19 replayed the board of 2026-08-07 at a 43-day gap,
// against a 90-day rule. Trading it with a later same-weekday date pushes the gap past 90.
//
// Both dates MUST be the same weekday: the tier is baked into the payload and the day's
// name/difficulty come from the date, so trading across weekdays would show a Saturday
// board labelled Tuesday. Checked below, not assumed.
//
// Dry by default. Pass --write to actually upsert.
//
//   npm run swap-pins -- --game kinship --a 2026-09-19 --b 2026-11-21
//   npm run swap-pins -- --game kinship --a 2026-09-19 --b 2026-11-21 --write
//
// Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import taxonomy from "../src/data/taxonomy.json";
import augment from "../src/data/taxonomyAugment.json";
import { buildTree, type TaxonNode, type Tree } from "../src/core";
import { CLADE_COMMON } from "../src/data/cladeNames";
import { SPECIES_COMMON } from "../src/data/speciesCommon";
import { computePuzzle, encodePuzzle, puzzleVersion, type Game } from "../src/data/pinnedPuzzles";

const GAMES: Game[] = ["lineage", "kinship", "branches"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  const game = arg("game") as Game | undefined;
  const a = arg("a");
  const b = arg("b");
  const write = process.argv.includes("--write");
  if (!game || !GAMES.includes(game) || !a || !b) {
    console.error("usage: --game <lineage|kinship|branches> --a <YYYY-MM-DD> --b <YYYY-MM-DD> [--write]");
    process.exit(1);
  }

  // The past is frozen: someone has already played it and their score is stored against
  // that board. pin_puzzle() refuses past dates server-side; this is the same rule here,
  // since a service-role upsert bypasses that check.
  const today = new Date().toISOString().slice(0, 10);
  if (a <= today || b <= today) {
    console.error(`Both dates must be in the future (today is ${today}). Refusing.`);
    process.exit(1);
  }
  if (weekday(a) !== weekday(b)) {
    console.error(`${a} and ${b} are different weekdays. A board carries its tier, so trading across weekdays would mislabel both days. Refusing.`);
    process.exit(1);
  }

  // Same correction layer as build() in loadTaxonomy — see pin-puzzles.ts.
  const withCommon = (nodes: TaxonNode[]): Tree =>
    buildTree(
      nodes.map((n) => {
        const fixed = n.rank === "species" ? SPECIES_COMMON[n.sciName] : CLADE_COMMON[n.sciName];
        return fixed ? { ...n, common: fixed } : n;
      })
    );
  const baseNodes = (taxonomy as { nodes: TaxonNode[] }).nodes;
  const tree =
    game === "lineage"
      ? withCommon(baseNodes)
      : withCommon([...baseNodes, ...(augment as { nodes: TaxonNode[] }).nodes]);

  const pa = computePuzzle(game, tree, a);
  const pb = computePuzzle(game, tree, b);
  if (!pa || !pb) {
    console.error(`No puzzle computed for ${!pa ? a : b}. Refusing.`);
    process.exit(1);
  }
  const version = puzzleVersion(game);

  console.log(`${game}: ${a} <-> ${b} (both weekday ${weekday(a)}), version ${version}`);
  console.log(`  ${a} will serve the board currently computed for ${b}`);
  console.log(`  ${b} will serve the board currently computed for ${a}`);
  if (!write) {
    console.log("\nDry run. Re-run with --write to apply.");
    return;
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows = [
    { game, puzzle_date: a, payload: encodePuzzle(game, pb), version },
    { game, puzzle_date: b, payload: encodePuzzle(game, pa), version },
  ];
  const { error } = await client.from("daily_puzzles").upsert(rows, { onConflict: "game,puzzle_date" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log("Swapped.");
}

main().catch((e) => { console.error(e); process.exit(1); });
