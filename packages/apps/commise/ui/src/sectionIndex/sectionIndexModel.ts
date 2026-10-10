/**
 * @module @commise/ui/section-index — what each status tone draws, decided once for both leaves
 * (`docs/design/uiOverhaul/buildSpec.md` §7.2, "Statuses"): its colour role, its glyph, whether it shows a count, and
 * its segment of the phone bar's progress line. The leaves only translate these into Tailwind classes or theme colours.
 *
 * @pattern Policy — closed tone → presentation tables over a discriminated string union
 */
import type { IconName } from '../icon/props.js';
import type { Role } from '../tokens/colors.js';
import type { SectionIndexItem, SectionIndexTone } from './props.js';

/**
 * The role a tone's reason and glyph are drawn in. `fix` takes `dangerText`, not `danger`: `danger` is the destructive
 * FILL (`darkTheme.md` §1, "confirm dialogs only") and is not lifted for the dark theme, where `dangerText` is.
 */
export const TONE_ROLE: Readonly<Record<SectionIndexTone, Role>> = {
    fix: 'dangerText',
    attention: 'attention',
    muted: 'inkMuted',
    complete: 'ink',
};

/** The glyph a tone draws. A muted item has none: its reason says it (SC 1.4.1). */
export const TONE_GLYPH: Readonly<Record<SectionIndexTone, IconName | undefined>> = {
    fix: 'triangleAlert',
    attention: 'triangleAlert',
    muted: undefined,
    complete: 'check',
};

/** A segment of the phone bar's progress line. */
export type ProgressSegment = 'done' | 'needsAction' | 'empty';

/** The segment a tone fills: complete is done, fix and attention need action, the rest is empty. */
export const TONE_SEGMENT: Readonly<Record<SectionIndexTone, ProgressSegment>> = {
    fix: 'needsAction',
    attention: 'needsAction',
    muted: 'empty',
    complete: 'done',
};

/**
 * The count an item shows beside its glyph in the strip: only `fix` and `attention` count.
 *
 * @param item - The item.
 * @returns The count, or `undefined` when none is shown.
 */
export function shownCountOf(item: SectionIndexItem): number | undefined {
    return item.tone === 'fix' || item.tone === 'attention' ? item.count : undefined;
}

/**
 * The item the phone bar names: the current one, or the first while nothing is current yet (before the first
 * scroll report).
 *
 * @param items - The items, in page order.
 * @param currentId - The current section's id.
 * @returns The item, or `undefined` for an empty index.
 */
export function barItemOf(
    items: readonly SectionIndexItem[],
    currentId: string | undefined,
): SectionIndexItem | undefined {
    return items.find((item) => item.id === currentId) ?? items[0];
}

/**
 * The role the phone bar's end count is drawn in: `dangerText` when any section must be fixed, else `attention`.
 *
 * @param items - The items.
 * @returns The role.
 */
export function barCountRoleOf(items: readonly SectionIndexItem[]): Role {
    return items.some((item) => item.tone === 'fix') ? TONE_ROLE.fix : TONE_ROLE.attention;
}

/**
 * The screen-reader description of an item where no `aria-describedby` exists (native's `accessibilityHint`): the
 * reason, then the hint when the presentation shows one.
 *
 * @param item - The item.
 * @param withHint - Whether this presentation shows the hint.
 * @returns The description, or `undefined` when there is nothing to describe.
 */
export function descriptionOf(item: SectionIndexItem, withHint: boolean): string | undefined {
    const parts = [item.reason ?? item.spokenStatus, withHint ? item.hint : undefined].filter(
        (part): part is string => part !== undefined && part !== '',
    );

    return parts.length > 0 ? parts.join(', ') : undefined;
}
