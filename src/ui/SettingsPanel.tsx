import type { ReactNode } from "react";
import type { GameConfig } from "../core";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";

interface Props {
  config: GameConfig;
  onScope: (id: string) => void;
  onWinWithin: (n: number) => void;
  assist: boolean;
  onAssist: (on: boolean) => void;
}

/** A little glyph for each scope, matched on its label keywords. Falls back to a
 *  generic branch mark so a new scope from the build still renders something. */
function scopeIcon(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("all life")) return "🌳";
  if (l.includes("animal")) return "🐾";
  if (l.includes("chordate")) return "🦴";
  if (l.includes("mammal")) return "🐘";
  if (l.includes("bird")) return "🐦";
  if (l.includes("fish")) return "🐟";
  if (l.includes("insect")) return "🦋";
  if (l.includes("arthropod")) return "🦂";
  if (l.includes("plant")) return "🌿";
  if (l.includes("fungi")) return "🍄";
  return "🌿";
}

/** Concentric "tolerance dial": rings grow with how loose a win is. The filled
 *  outer ring shows the radius that still counts as a hit. */
function Rings({ n }: { n: number }) {
  const radii = [4, 8, 12, 16];
  const active = radii[Math.min(n, radii.length - 1)];
  return (
    <svg className="chip-rings" viewBox="0 0 36 36" aria-hidden="true">
      {radii.map((r) => (
        <circle key={r} cx="18" cy="18" r={r} className={r <= active ? "on" : "off"} />
      ))}
      <circle cx="18" cy="18" r="1.6" className="core" />
    </svg>
  );
}

interface ChipProps {
  on: boolean;
  onClick: () => void;
  glyph: ReactNode;
  label: string;
  sub?: string;
}
function Chip({ on, onClick, glyph, label, sub }: ChipProps) {
  return (
    <button type="button" className={`chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className="chip-ico">{glyph}</span>
      <span className="chip-body">
        <span className="chip-txt">{label}</span>
        {sub && <span className="chip-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function SettingsPanel({ config, onScope, onWinWithin, assist, onAssist }: Props) {
  return (
    <div className="settings">
      <fieldset className="optgroup">
        <legend>Scope — where the tree is rooted</legend>
        <div className="chips">
          {SCOPE_PRESETS.map((s) => (
            <Chip
              key={s.id}
              on={config.scopeRootId === s.id}
              onClick={() => onScope(s.id)}
              glyph={scopeIcon(s.label)}
              label={s.label.replace(/\s+only$/i, "")}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="optgroup">
        <legend>Resolution — how close counts as a win</legend>
        <div className="chips">
          {RESOLUTION_PRESETS.map((r) => (
            <Chip
              key={r.winWithin}
              on={config.winWithin === r.winWithin}
              onClick={() => onWinWithin(r.winWithin)}
              glyph={<Rings n={r.winWithin} />}
              label={r.label}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="optgroup">
        <legend>Difficulty — how much the search helps</legend>
        <div className="chips">
          <Chip
            on={!assist}
            onClick={() => onAssist(false)}
            glyph="🌐"
            label="Hard"
            sub="Search all of scope"
          />
          <Chip
            on={assist}
            onClick={() => onAssist(true)}
            glyph="🔍"
            label="Focused"
            sub="Only the closest branch"
          />
        </div>
      </fieldset>
    </div>
  );
}
