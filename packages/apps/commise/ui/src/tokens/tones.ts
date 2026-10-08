/**
 * @module tokens/tones — the difficulty and status tones (`docs/design/uiOverhaul/buildSpec.md` §1.4).
 *
 * A tone is a fill and the label painted on it, chosen TOGETHER and measured together (`__tests__/tones.test.ts`), so
 * no badge picks a background and a text colour independently.
 *
 * - **Difficulty** is a tint of its own hue with a darker label of the same family, and always travels with the
 *   three-dot meter, so it never relies on colour (SC 1.4.1). `error` is never a difficulty: Hard is coral.
 *   ⚠️ Every pair clears 4.5:1 over `paper`; Medium measures 4.37:1 over the sand `canvas`, so the badge sits on a card
 *   (a measured gap in the spec, raised with `staff-ux-engineer`).
 * - **Status** (Draft, Private, Public) is neutral for every status — `pearl` with `ink`, never amber — and the icon is
 *   what tells the three apart.
 *
 * Pure data; no consumer yet. Slice 2's `StatusBadge` and the difficulty badge read these.
 *
 * @pattern Registry — a record keyed by a closed union, so a new difficulty or status is a compile error until it has
 *   a tone
 */
import { palette, role, tint } from './colors.js';

/** A recipe difficulty. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** A recipe's publication status, as a badge states it. */
export type RecipeStatus = 'draft' | 'private' | 'public';

/**
 * The glyph a status badge carries, by its Lucide name (§1.7).
 *
 * ⚠️ Declared here only until slice 2 adds the icon Registry's `IconName`; then this becomes that type.
 */
export type StatusIconName = 'pencil-line' | 'lock' | 'globe';

/** A fill and the label painted on it. */
export interface Tone {
    readonly fill: string;
    readonly text: string;
}

/** A status tone: a neutral pair plus the glyph that distinguishes it. */
export interface StatusTone extends Tone {
    readonly icon: StatusIconName;
}

/** The difficulty tones: each a 15% tint of its hue, labelled in that hue's text role. */
export const difficultyTone: Readonly<Record<Difficulty, Tone>> = {
    easy: { fill: tint(palette.success, 0.15), text: role.actionText },
    medium: { fill: tint(palette.warning, 0.15), text: role.attention },
    hard: { fill: tint(palette.coral, 0.15), text: role.ink },
};

/** The status tones: one neutral pair for every status, told apart by the icon. */
export const statusTone: Readonly<Record<RecipeStatus, StatusTone>> = {
    draft: { fill: palette.pearl, text: role.ink, icon: 'pencil-line' },
    private: { fill: palette.pearl, text: role.ink, icon: 'lock' },
    public: { fill: palette.pearl, text: role.ink, icon: 'globe' },
};
