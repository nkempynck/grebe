import { useState } from "react";
import { TIER_LABEL, type Badge } from "../data/badges";

/** The badge wall, shared by every badge panel. EVERY badge is clickable and opens
 *  the same detail block: what the badge means, what you did for it, and the dates
 *  behind it when there are any. Badges without dates used to be inert, which left
 *  a medal on screen with nothing to explain it. */
export function BadgeGrid({ badges }: { badges: Badge[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = badges.find((b) => b.id === openId) ?? null;

  return (
    <>
      <div className="badge-grid">
        {badges.map((b) => (
          <button
            type="button"
            className={`badge badge-${b.tier} is-clickable${openId === b.id ? " is-open" : ""}`}
            key={b.id}
            title={b.desc}
            aria-expanded={openId === b.id}
            onClick={() => setOpenId((id) => (id === b.id ? null : b.id))}
          >
            <span className="badge-medal"><span className="badge-ico" aria-hidden="true">{b.icon}</span></span>
            <span className="badge-label">{b.label}</span>
            {b.occurrences && b.occurrences.length > 1 && <span className="badge-count">×{b.occurrences.length}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="badge-info" role="status">
          <div className="badge-info-hd">
            <span className="badge-info-ico" aria-hidden="true">{open.icon}</span>
            <span className="badge-info-ttl">{open.label}</span>
            {TIER_LABEL[open.tier] && <span className="badge-info-tier">{TIER_LABEL[open.tier]}</span>}
          </div>
          <p>{open.criteria}</p>
          <p className="badge-info-you">{open.desc}</p>
          {open.occurrences && open.occurrences.length > 0 && (
            <div className="badge-info-dates">
              <span className="badge-dates-lbl">{open.occLabel ?? "won"}</span>
              {open.occurrences.map((o) => <span className="badge-date" key={o}>{o}</span>)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
