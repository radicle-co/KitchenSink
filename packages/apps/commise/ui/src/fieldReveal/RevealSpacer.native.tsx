/**
 * @module @commise/ui/field-reveal — the blank space at the end of a scroller's content that gives a field reveal room
 * to scroll (`docs/design/rowEditorOpenDecisions.md` E1). Its host sizes it and reads its layout; it shows nothing and
 * is hidden from screen readers. A presentational component.
 *
 * @pattern Strut — an invisible box of a set height that reserves room, as Swing's `Box.createVerticalStrut`
 */
import type { FC } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

/** Props for {@link RevealSpacer}, as `useFieldRevealHost` hands them out. */
export interface RevealSpacerProps {
    /** The space's height, in dp. */
    readonly height: number;
    /** Reports where the space was laid out. */
    readonly onLayout: (event: LayoutChangeEvent) => void;
}

/** The space. */
export const RevealSpacer: FC<RevealSpacerProps> = ({ height, onLayout }) => (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ height }} onLayout={onLayout} />
);
