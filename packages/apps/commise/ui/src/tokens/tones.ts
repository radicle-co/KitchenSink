/**
 * @module tokens/tones — the difficulty and status tones (`docs/design/uiOverhaul/buildSpec.md` §1.4).
 *
 * A tone is a fill and the label painted on it, chosen TOGETHER and measured together (`__tests__/tones.test.ts`), so
 * no badge picks a background and a text colour independently.
 *
 * - **Difficulty** is neutral for every level and always travels with the three-dot meter, so it never relies on
 *   colour (SC 1.4.1). `error` is never a difficulty.
 * - **Status** (Draft, Private, Public) is neutral for every status — `surfaceMuted` with `ink`, never amber — and the
 *   icon is what tells the three apart.
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
    easy: { fill: role.surfaceMuted, text: role.ink },
    medium: { fill: role.surfaceMuted, text: role.ink },
    hard: { fill: role.surfaceMuted, text: role.ink },
};

/** The status tones: one neutral pair for every status, told apart by the icon. */
export const statusTone: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: role.surfaceMuted, text: role.ink, icon: 'pencilLine' },
    private: { fill: role.surfaceMuted, text: role.ink, icon: 'lock' },
    public: { fill: role.surfaceMuted, text: role.ink, icon: 'globe' },
};

/** The difficulty tones in the dark theme: the dark `surfaceMuted` under dark `ink`. */
export const difficultyToneDark: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: roleDark.surfaceMuted, text: roleDark.ink },
    medium: { fill: roleDark.surfaceMuted, text: roleDark.ink },
    hard: { fill: roleDark.surfaceMuted, text: roleDark.ink },
};

/** The status tones in the dark theme: the dark `surfaceMuted` under dark `ink`, glyphs as in light. */
export const statusToneDark: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'pencilLine' },
    private: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'lock' },
    public: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'globe' },
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
