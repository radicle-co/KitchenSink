/**
 * @module @commise/ui/create-fab — the native face of a floating create control: its surface, glyph and label.
 *
 * - **iOS 26:** seafoam-tinted Liquid Glass, interactive, with a semibold label (D13). The system keeps the label legible
 *   over whatever scrolls beneath.
 * - **Android and older iOS:** a solid `action` disc or pill at level 3 with the `onAction` label.
 *
 * In the icon form the label leaves the face; the CONTROL keeps it as its accessible name. A hidden twin of the label
 * reports its natural width through `onLayout`, for the "fits in half the window" rule.
 *
 * Presentational: props → JSX; the twin's `onLayout` is its one measurement.
 *
 * @pattern Adapter over `expo-glass-effect`, with a solid fallback where the platform has no glass
 */
import { GlassView } from 'expo-glass-effect';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { hasLiquidGlass } from '../chromeSurface/liquidGlass.native.js';
import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { FAB_HEIGHT_PX } from './createFabPolicy.js';
import type { FabFaceProps } from './props.js';

/** The native face of a floating create control. */
export const FabFace: FC<FabFaceProps> = ({ label, icon, presentation, onLabelWidth }) => {
    const { colors } = useTheme();
    const glass = hasLiquidGlass();
    const ink = glass ? colors.ink : colors.onAction;
    const shape = presentation === 'icon' ? styles.disc : styles.pill;

    const content: ReactNode = (
        <>
            <Icon name={icon} size={24} tone={glass ? 'ink' : 'onAction'} />
            {presentation === 'extended' ? (
                <Text numberOfLines={1} style={[styles.label, { color: ink }]}>
                    {label}
                </Text>
            ) : null}
            <Text
                aria-hidden
                numberOfLines={1}
                onLayout={(event) => onLabelWidth(event.nativeEvent.layout.width)}
                style={[styles.label, styles.twin]}
            >
                {label}
            </Text>
        </>
    );

    if (glass) {
        return (
            <GlassView
                glassEffectStyle="regular"
                tintColor={colors.action}
                isInteractive
                colorScheme="auto"
                style={[styles.face, shape]}
            >
                {content}
            </GlassView>
        );
    }

    return (
        <View style={[styles.face, shape, nativeTokens.elevation.lg, { backgroundColor: colors.action }]}>
            {content}
        </View>
    );
};

const styles = StyleSheet.create({
    face: {
        height: FAB_HEIGHT_PX,
        borderRadius: FAB_HEIGHT_PX / 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    disc: { width: FAB_HEIGHT_PX, justifyContent: 'center' },
    pill: { gap: nativeTokens.spacing[2], paddingStart: nativeTokens.spacing[4], paddingEnd: nativeTokens.spacing[6] },
    label: { ...nativeTokens.type.label },
    // Out of flow and invisible: it only reports the label's natural width.
    twin: { position: 'absolute', opacity: 0, start: 0, top: 0 },
});
