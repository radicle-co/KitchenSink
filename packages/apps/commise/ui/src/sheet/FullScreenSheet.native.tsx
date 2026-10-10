/**
 * @module @commise/ui/full-screen-sheet — the design system's full-screen modal sheet, for React Native only.
 *
 * The ONE place the "full-screen RN `Modal` sheet" shape lives. Three feature leaves — `PullUpdatesDialog`,
 * `VersionPreviewModal` and `VersionCompareView` — each hand-rolled the same `<Modal presentationStyle="fullScreen">`
 * wrapping a `{ flex: 1, padding: 20 }` surface, and all three shipped the same defect with it: an Android full-screen
 * `Modal` window spans the ENTIRE display (the app is edge-to-edge), so a flat pad put the sheet's heading UNDER the
 * status bar and its Cancel/confirm row UNDER the navigation bar.
 *
 * On-device that meant the heading was not merely ugly but *gone*: fully occluded by the status-bar window, it dropped
 * out of the accessibility hierarchy altogether — which is how Maestro's `collectionsPull` flow caught it (`Assert
 * "Pull Updates from Source Collection" is visible` failed against a screenshot in which the text was plainly drawn),
 * while the footer buttons overlapped the navigation bar's own tap targets.
 *
 * Consumers own their own content and their own `onRequestClose` meaning; this primitive owns only the modal window,
 * its motion and the inset math, so a new sheet cannot reintroduce the bug by copying a neighbour. It slides in only
 * when the platform has said reduce motion is off, by the `Sheet`'s rule (`sheetAnimationType`, curated D10, WCAG
 * 2.3.3).
 *
 * @pattern Decorator over the design-system `Modal` — it adds the window insets and the reduce-motion rule, nothing
 *     else
 */
import type { FC, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Modal } from '../modal/Modal.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { sheetAnimationType } from './sheetPresentation.js';

/**
 * The sheet's base edge padding, in dp, BEFORE the device's window insets are added. Exported so a test can
 * assert the composed padding rather than restating the literal (which would pass even if the inset term
 * were dropped).
 */
export const SHEET_PADDING = 20;

/** Props for {@link FullScreenSheet}. */
export interface FullScreenSheetProps {
    /**
     * Accessible name for the sheet's surface — the container consumers' assertions and assistive tech
     * address. Consumers still render their own visible heading inside.
     */
    readonly label?: string;
    /**
     * The single dismissal path: RN routes the Android hardware-back (and web Escape) here, and consumers
     * wire their explicit Cancel control to the SAME callback so a sheet never grows two exits.
     */
    readonly onRequestClose: () => void;
    /**
     * Called once the Modal is presented (`Modal.onShow`). A mount effect runs before then, so a host that moves the
     * reading cursor into the sheet does it here (design §S8.1, §S16).
     */
    readonly onShow?: () => void;
    readonly children?: ReactNode;
}

/**
 * A full-screen modal sheet whose content clears the device's system bars.
 *
 * @param props - The accessible label, the dismissal callback, and the sheet body.
 * @returns The modal window wrapping an inset-padded surface.
 */
export const FullScreenSheet: FC<FullScreenSheetProps> = ({ label, onRequestClose, onShow, children }) => {
    const insets = useSafeAreaInsets();
    const reduceMotion = useReduceMotion();
    const { colors } = useTheme();

    return (
        <Modal
            visible
            onRequestClose={onRequestClose}
            onShow={onShow}
            animationType={sheetAnimationType(reduceMotion)}
            presentationStyle="fullScreen"
        >
            <View
                collapsable={false}
                accessibilityLabel={label}
                style={[
                    styles.surface,
                    {
                        backgroundColor: colors.paper,
                        // Base pad PLUS the device inset on every edge — the whole point of this primitive.
                        paddingTop: SHEET_PADDING + insets.top,
                        paddingBottom: SHEET_PADDING + insets.bottom,
                        paddingLeft: SHEET_PADDING + insets.left,
                        paddingRight: SHEET_PADDING + insets.right,
                    },
                ]}
            >
                {children}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    surface: { flex: 1, gap: 16 },
});
