/**
 * @module @commise/features-recipes — native full-screen modal sheet primitive.
 *
 * The ONE place the "full-screen RN `Modal` sheet" shape lives. Three feature leaves —
 * {@link import('../collections/PullUpdatesDialog.native.js').PullUpdatesDialog},
 * {@link import('../versions/VersionPreviewModal.native.js').VersionPreviewModal} and
 * {@link import('../versions/VersionCompareView.native.js').VersionCompareView} — each hand-rolled the same
 * `<Modal presentationStyle="fullScreen">` wrapping a `{ flex: 1, padding: 20 }` surface, and all three
 * shipped the same defect with it: an Android full-screen `Modal` window spans the ENTIRE display (the app
 * is edge-to-edge, as `HomeScreen`/`RecipesScreen` already compensate for with `useSafeAreaInsets`), so a
 * flat pad put the sheet's heading UNDER the status bar and its Cancel/confirm row UNDER the navigation bar.
 *
 * On-device that meant the heading was not merely ugly but *gone*: fully occluded by the status-bar window,
 * it dropped out of the accessibility hierarchy altogether — which is how Maestro's `collections-pull` flow
 * caught it (`Assert "Pull Updates from Source Collection" is visible` failed against a screenshot in which
 * the text was plainly drawn), while the footer buttons overlapped the navigation bar's own tap targets.
 *
 * PATTERN — Decorator over RN's `Modal`: it adds the window-inset concern and nothing else, keeping every
 * consumer a pure `props → JSX` surface. Consumers own their own content and their own `onRequestClose`
 * meaning; this primitive owns only the modal window and the inset math, so a fourth sheet cannot
 * reintroduce the bug by copying a neighbour.
 */
import { palette } from '@commise/ui';
import type { FC, ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
    readonly children?: ReactNode;
}

/**
 * A full-screen modal sheet whose content clears the device's system bars.
 *
 * @param props - The accessible label, the dismissal callback, and the sheet body.
 * @returns The modal window wrapping an inset-padded surface.
 */
export const FullScreenSheet: FC<FullScreenSheetProps> = ({ label, onRequestClose, children }) => {
    const insets = useSafeAreaInsets();

    return (
        <Modal visible onRequestClose={onRequestClose} animationType="slide" presentationStyle="fullScreen">
            <View
                accessibilityLabel={label}
                style={[
                    styles.surface,
                    {
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
    surface: { flex: 1, backgroundColor: palette.white, gap: 16 },
});
