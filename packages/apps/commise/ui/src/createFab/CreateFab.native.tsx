/**
 * @module @commise/ui/create-fab — the native design-system {@link CreateFab} (see `props.ts`): the floating button over
 * the screen's foot, 16 pt in on phones and 24 pt on tablets (bottom-left in a right-to-left layout), drawn by `FabFace`.
 * Render it as a SIBLING after the screen's scroller, inside the screen's `ScrollHost`, so it floats and reads its
 * scroll. Its presentation comes from `createFabPolicy` through `useFabPresentation`.
 *
 * Presentational about data — it fetches and mutates nothing — though its presentation reads the screen's scroll,
 * keyboard and window.
 *
 * @pattern Policy — `createFabPolicy` decides, the leaf draws
 */
import { useState, type FC } from 'react';
import { Pressable, StyleSheet } from 'react-native';

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
    const inset = viewportClassOf(useWindowWidth()) === 'compact' ? styles.phone : styles.tablet;

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
            style={[styles.corner, inset]}
        >
            <FabFace label={label} icon={icon} presentation={presentation} onLabelWidth={setLabelWidthPx} />
        </Pressable>
    );
};

const styles = StyleSheet.create({
    corner: { position: 'absolute', bottom: nativeTokens.spacing[4] },
    phone: { end: nativeTokens.spacing[4] },
    tablet: { end: nativeTokens.spacing[6] },
});
