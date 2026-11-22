/**
 * @module @commise/ui/icon-button — the shared contract of the design-system `IconButton`: one glyph in a touch target,
 * named by the caller. The glyph never names the control; the label does.
 */
import type { IconName } from '../icon/props.js';

/** The side of the visible circle, in points: the 44 the design draws on both platforms. */
export const ICON_BUTTON_CIRCLE_PX = 44;

/** The cross-platform `IconButton` contract shared by the web and native leaves. */
export interface IconButtonProps {
    /** The meaning to draw: a glyph from the icon Registry. */
    readonly icon: IconName;
    /** The control's accessible name, already localised by the caller. */
    readonly accessibilityLabel: string;
    /** Called once per press. */
    readonly onPress: () => void;
}
