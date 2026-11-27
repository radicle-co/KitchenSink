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
    /** Called once per press, and never while {@link disabled}. */
    readonly onPress: () => void;
    /**
     * A host asks for focus on the button: keyboard focus on web, the screen-reader cursor on native. A LEVEL, as on
     * `Button`: it stands until {@link onFocusRequestHandled} acknowledges it.
     */
    readonly focusRequested?: boolean;
    /** Called once the button has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
    /** The glyph's colour: ink (the default) or the muted ink of a secondary control such as a field's clear. */
    readonly tone?: IconButtonTone;
    /**
     * Whether the control is unavailable right now. It is refused but stays focusable (web `aria-disabled` with a
     * cancelled click; native `disabled`), and it dims to 40% on both platforms.
     */
    readonly disabled?: boolean;
}

/** The colours of the glyph. They are never stacked: a control has one. */
export type IconButtonTone = 'ink' | 'inkMuted';
