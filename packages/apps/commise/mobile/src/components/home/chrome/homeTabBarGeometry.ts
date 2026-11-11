/**
 * @module home/chrome/homeTabBarGeometry — the bottom tab bar's side padding and the room it leaves a tab label. The bar
 * reads these values, and the per-locale fit test reads {@link tabLabelRoom} to prove that no label breaks inside a word
 * at the chrome cap (designer ruling 2026-11-01, ADR-0080 §8). Pure, and free of React Native so a node test can load it.
 *
 * @pattern Specification — one pure rule for a tab's label room, read by the bar and by the fit test
 */
import { nativeTokens } from '@commise/ui/native';
import type { ChromeCap } from '@commise/ui/scaled-type';

/** The chrome cap a tab label grows to: navigation chrome, so 1.5× (ADR-0080 §8). */
export const TAB_BAR_CHROME_CAP = '1.5' satisfies ChromeCap;

/**
 * The bar's own side padding, in dp; the safe-area inset is added to it. None: four tabs must be 80 wide at 320
 * (`buildSpec.md` §3.2), which the full width alone gives.
 */
export const TAB_BAR_SIDE_PADDING = 0;

/** The role a tab's label is drawn in: `label` when the tab is active, `caption` when it is not. */
export const TAB_LABEL_ROLE = { active: 'label', inactive: 'caption' } as const satisfies Record<
    string,
    keyof typeof nativeTokens.type
>;

/** What {@link tabLabelRoom} reads. */
export interface TabLabelRoomInput {
    /** The screen's width, in dp, less nothing: the safe-area insets are not included (a portrait phone has none). */
    readonly screenWidth: number;
    /** How many tabs share the bar. */
    readonly count: number;
}

/**
 * The width a label has inside one of `count` tabs that share the bar equally. A tab has no padding of its own, so the
 * room is the bar's width, less its side padding, divided by the count. Pure.
 *
 * @param input - The screen's width and the number of tabs.
 * @returns The label's room, in dp.
 * @throws Error when there are no tabs.
 */
export function tabLabelRoom({ screenWidth, count }: TabLabelRoomInput): number {
    if (count < 1) {
        throw new Error('A tab bar has at least one tab.');
    }

    return (screenWidth - 2 * TAB_BAR_SIDE_PADDING) / count;
}
