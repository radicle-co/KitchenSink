/**
 * @module @commise/ui/create-fab — the shared contract of the design-system `CreateFab`, the floating "New recipe" /
 * "New collection" button on phones and tablets (`docs/design/uiOverhaul/buildSpec.md` §3.4; ownerDecisions D4, D13).
 *
 * The button owns its rules — `createFabPolicy.ts` decides its presentation from the screen's scroll (`ScrollHost`),
 * the keyboard, the window and the label's width; this contract only names what the screen supplies:
 *
 * - **Name:** always the label, in the icon-only form too (SC 2.5.3). Never "plus" or "add".
 * - **Where:** web draws it fixed at the bottom trailing corner above the tab bar (16 px in on phones, 24 on tablets;
 *   bottom-left in RTL) and puts it RIGHT AFTER the H1 in DOM order (`LargeTitleHeader.afterTitle`), so a screen reader
 *   meets it early. Native draws it over the screen's foot, a sibling of the scroller.
 * - **Surface:** solid `action` at level 3 on web, Android and older iOS; seafoam-tinted Liquid Glass with a semibold
 *   label on iOS 26 (D13), whose system keeps the label legible.
 */
import type { IconName } from '../icon/props.js';
import type { FabPresentation } from './createFabPolicy.js';

/** The cross-platform `CreateFab` contract. */
export interface CreateFabProps {
    /** The visible label AND the accessible name: "New recipe" or "New collection". */
    readonly label: string;
    /** The glyph's meaning. */
    readonly icon: IconName;
    /** Run the create action. */
    readonly onPress: () => void;
    /** Whether the screen shows its first-run state, whose own start buttons take this button's place. */
    readonly firstRun?: boolean;
}

/** The face the floating create control (`CreateFab`) draws. */
export interface FabFaceProps {
    readonly label: string;
    readonly icon: IconName;
    /** `icon` or `extended`; a `hidden` button is not drawn. */
    readonly presentation: Exclude<FabPresentation, 'hidden'>;
    /** Reports the label's natural width, which decides whether it fits (half the window). */
    readonly onLabelWidth: (px: number) => void;
}

/** What the presentation hook reads from the control itself. */
export interface FabSelf {
    readonly firstRun: boolean;
    readonly focused: boolean;
    readonly labelWidthPx: number;
}
