/**
 * @module tokens/tones — the difficulty and status tones (`docs/design/uiOverhaul/buildSpec.md` §1.4).
 *
 * A tone is a fill and the label painted on it, chosen TOGETHER and measured together (`__tests__/tones.test.ts`), so
 * no badge picks a background and a text colour independently.
 *
 * - **Difficulty** is a tint of its own hue with a darker label of the same family, and always travels with the
 *   three-dot meter, so it never relies on colour (SC 1.4.1). `error` is never a difficulty: Hard is coral.
 *   Every pair clears 4.5:1 over `paper` and the `canvas` in both themes (`darkTheme.md` §2).
 * - **Status** (Draft, Private, Public) is neutral for every status — `surfaceMuted` with `ink`, never amber — and the
 *   icon is what tells the three apart.
 * - Each tone has a dark twin (`*ToneDark`); PRO is one fixed pair in both themes.
 *
 * Pure data. `StatusBadge` reads the status tones; the difficulty tones wait for the difficulty badge (slice 4).
 *
 * @pattern Registry — a record keyed by a closed union, so a new difficulty or status is a compile error until it has
 *   a tone
 */
import type { IconName } from '../icon/props.js';
import { palette, role, roleDark, tint } from './colors.js';

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

/** The difficulty tones: each a 15% tint of its hue, labelled in that hue's text role. */
export const difficultyTone: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: tint(palette.success, 0.15), text: role.actionText },
    medium: { fill: tint(palette.warning, 0.15), text: role.attention },
    hard: { fill: tint(palette.coral, 0.15), text: role.ink },
};

/** The status tones: one neutral pair for every status, told apart by the icon. */
export const statusTone: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: role.surfaceMuted, text: role.ink, icon: 'pencilLine' },
    private: { fill: role.surfaceMuted, text: role.ink, icon: 'lock' },
    public: { fill: role.surfaceMuted, text: role.ink, icon: 'globe' },
};

/** The difficulty tones in the dark theme (`darkTheme.md` §2): each hue at 18%, labelled in the dark text role. */
export const difficultyToneDark: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: tint(palette.success, 0.18), text: roleDark.actionText },
    medium: { fill: tint(palette.warning, 0.18), text: roleDark.attention },
    hard: { fill: tint(palette.coral, 0.18), text: roleDark.ink },
};

/** The status tones in the dark theme: the dark `surfaceMuted` under dark `ink`, glyphs as in light. */
export const statusToneDark: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'pencilLine' },
    private: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'lock' },
    public: { fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'globe' },
};

/**
 * The PRO badge: `premium` under `charcoal` (5.70:1), FIXED in both themes (`darkTheme.md` §2). Web reads it as
 * `bg-pro-fill text-pro-ink`, which the dark block deliberately does not override.
 */
export const proTone: Tone = { fill: palette.premium, text: palette.charcoal };
