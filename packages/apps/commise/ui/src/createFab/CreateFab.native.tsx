/**
 * @module @commise/ui/create-fab — the native design-system {@link CreateFab} (see `props.ts`): the floating button over
 * the screen's foot, 16 pt in on phones and 24 pt on tablets (bottom-left in a right-to-left layout), drawn by `FabFace`.
 * Held sideways it adds the safe-area inset on its end side to that margin (owner 2026-10-13), so a cutout or the 3-button
 * navigation bar never covers it.
 * Render it as a SIBLING after the screen's scroller, inside the screen's `ScrollHost`, so it floats and reads its
 * scroll. Its presentation comes from `createFabPolicy` through `useFabPresentation`.
 *
 * Presentational about data — it fetches and mutates nothing — though its presentation reads the screen's scroll,
 * keyboard and window.
 *
 * @pattern Policy — `createFabPolicy` decides, the leaf draws
 */
import { useState, type FC } from 'react';
import { I18nManager, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { viewportClassOf } from '../layout/containerClass.js';
import { useWindowWidth } from '../screenEnvironment/useWindowWidth.native.js';
import { nativeTokens } from '../tokens/native.js';
import { FabFace } from './FabFace.native.js';
import type { CreateFabProps } from './props.js';
import { useFabPresentation } from './useFabPresentation.native.js';

/** The native design-system floating create button. */
export const CreateFab: FC<CreateFabProps> = ({ label, icon, onPress, firstRun = false }) => {
    const [focused, setFocused] = useState(false);
    const [labelWidthPx, setLabelWidthPx] = useState(0);
    const presentation = useFabPresentation({ firstRun, focused, labelWidthPx });
    const margin = viewportClassOf(useWindowWidth()) === 'compact' ? PHONE_MARGIN : TABLET_MARGIN;
    const insets = useSafeAreaInsets();
    const sideInset = I18nManager.isRTL ? insets.left : insets.right;

    if (presentation === 'hidden') {
        return null;
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[styles.corner, { end: margin + sideInset }]}
        >
            <FabFace label={label} icon={icon} presentation={presentation} onLabelWidth={setLabelWidthPx} />
        </Pressable>
    );
};

/** The button's margin from the window's end edge, before the safe-area inset is added. */
const PHONE_MARGIN = nativeTokens.spacing[4];
const TABLET_MARGIN = nativeTokens.spacing[6];

const styles = StyleSheet.create({
    corner: { position: 'absolute', bottom: nativeTokens.spacing[4] },
});
