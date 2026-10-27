/**
 * @module tokens/tones — the difficulty and status tones (`docs/design/uiOverhaul/buildSpec.md` §1.4).
 *
 * A tone is a fill and the label painted on it, chosen TOGETHER and measured together (`__tests__/tones.test.ts`), so
 * no badge picks a background and a text colour independently.
 *
 * - **Difficulty** is neutral for every level and always travels with the three-dot meter, so it never relies on
 *   colour (SC 1.4.1). `error` is never a difficulty.
 * - **Status** (Draft, Private, Public) is neutral for every status — `paper` with `inkMuted`, never amber — and the
 *   icon is what tells the three apart.
 * - **A neutral badge is paper with a 1 px `lineDivider` edge** (`componentFixes.md` §7, 2026-10-27). It used to be
 *   `surfaceMuted`, so it vanished on any `surfaceMuted` parent (a notice, a pressed row, a raised dark surface). The
 *   edge is the component's, not the tone's: a tone is the fill and the label, and PRO and `attention` have no edge.
 * - Each tone has a dark twin (`*ToneDark`), PRO included.
 *
 * Pure data. `StatusBadge` reads the status tones; the difficulty tones wait for the difficulty badge (slice 4).
 *
 * @pattern Registry — a record keyed by a closed union, so a new difficulty or status is a compile error until it has
 *   a tone
 */
import type { IconName } from '../icon/props.js';
import { palette, role, roleDark } from './colors.js';

/** A recipe difficulty. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** A recipe's publication status, as a badge states it. */
export type RecipeStatus = 'draft' | 'private' | 'public';

/** A fill and the label painted on it. */
export interface Tone {
    readonly fill: string;
    readonly text: string;
}

/** A status tone: a neutral pair plus the glyph that distinguishes it. */
export interface StatusTone extends Tone {
    /** The meaning the badge draws, from the icon Registry. */
    readonly icon: IconName;
}

/**
 * The difficulty tones: one neutral pair for every level, told apart by the three-dot meter and never by colour
 * (redesign: a difficulty chip has no hue). Typed by level so a new difficulty is a compile error until it has a tone.
 */
export const difficultyTone: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: role.paper, text: role.inkMuted },
    medium: { fill: role.paper, text: role.inkMuted },
    hard: { fill: role.paper, text: role.inkMuted },
};

/** The status tones: one neutral pair for every status, told apart by the icon. */
export const statusTone: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: role.paper, text: role.inkMuted, icon: 'pencilLine' },
    private: { fill: role.paper, text: role.inkMuted, icon: 'lock' },
    public: { fill: role.paper, text: role.inkMuted, icon: 'globe' },
};

/** The difficulty tones in the dark theme: dark `paper` under dark `inkMuted`. */
export const difficultyToneDark: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: roleDark.paper, text: roleDark.inkMuted },
    medium: { fill: roleDark.paper, text: roleDark.inkMuted },
    hard: { fill: roleDark.paper, text: roleDark.inkMuted },
};

/** The status tones in the dark theme: dark `paper` under dark `inkMuted`, glyphs as in light. */
export const statusToneDark: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: roleDark.paper, text: roleDark.inkMuted, icon: 'pencilLine' },
    private: { fill: roleDark.paper, text: roleDark.inkMuted, icon: 'lock' },
    public: { fill: roleDark.paper, text: roleDark.inkMuted, icon: 'globe' },
};

/**
 * The PRO badge: GREY, not steel, and not the neutral `surfaceMuted` chip. That chip vanished on a `surfaceMuted` area
 * (the editor's visibility card), so PRO takes the darker `slate` fill under `snow` in light and a light grey under
 * `charcoal` in dark: each fill is seen against canvas, paper and `surfaceMuted` (SC 1.4.11) and each label is read on
 * its fill (SC 1.4.3). Both pairs are measured in `__tests__/redesignContrast.test.ts`. ONE source: web emits it as
 * `--color-pro-*` and native reads it from the theme.
 */
export const proTone: Tone = { fill: palette.slate, text: palette.snow };

/** The PRO badge in the dark theme: the dark muted-ink grey under `charcoal`. */
export const proToneDark: Tone = { fill: roleDark.inkMuted, text: palette.charcoal };
