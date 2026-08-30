import { useEffect, useState } from "react";
import { todayKey } from "../core/daily";
import { boardGuardCached, fetchBoardGuard, GUARD_UNKNOWN, type BoardGuard } from "../data/boardGuard";

/** Today's Kinship and Branches boards, for the games that must not give them away.
 *
 *  Fetched unconditionally, and cheaply: these are the same two pinned rows Kinship and Branches
 *  already read, so on a normal session this resolves straight out of the pin cache. WHERE it
 *  applies is decided by the consumer, not here — useGame ignores it outside free play, because
 *  the daily's answer can sit inside a board clade and blocking there would make the day
 *  unwinnable.
 *
 *  Resolves to GUARD_UNKNOWN on any failure, which isGuarded() reads as "block nothing". That is
 *  the opposite of Mosaic's use of the same guard, and deliberately so: there an unknown hides
 *  two optional panels, here it would decide what is guessable. */
export function useBoardGuard(): BoardGuard {
  const date = todayKey();
  const [guard, setGuard] = useState<BoardGuard>(() => boardGuardCached(date) ?? GUARD_UNKNOWN);
  useEffect(() => {
    const cached = boardGuardCached(date);
    if (cached) { setGuard(cached); return; }
    let live = true;
    void fetchBoardGuard(date).then((g) => { if (live) setGuard(g); });
    return () => { live = false; };
  }, [date]);
  return guard;
}
