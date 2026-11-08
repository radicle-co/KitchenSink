/**
 * @module @commise/features-recipes/ingredientMatching — `SeeWhy` (native): the React Native leaf of `./SeeWhy.tsx`, on the
 * same props. The disclosure button carries `accessibilityState.expanded`; the reason opens in place under it in the
 * 14 px `meta` role, muted, is announced once on opening (`onOpen`), and closes on a second tap. Painted from the theme's
 * roles (D15).
 *
 * Orchestration: it holds the open state, so it is not a pure render leaf.
 *
 * @pattern Disclosure — a button with an expanded state that reveals its region in place
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SeeWhyProps } from './seeWhyProps.js';

/** The See why disclosure. */
export const SeeWhy: FC<SeeWhyProps> = ({ label, name, reason, onOpen }) => {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <View style={styles.root}>
            <Button
                variant="ghost"
                size="sm"
                expanded={open}
                {...(name === undefined ? {} : { accessibilityLabel: name })}
                onPress={() => {
                    if (!open) {
                        onOpen();
                    }

                    setOpen(!open);
                }}
            >
                {label}
            </Button>
            {open ? <Text style={[styles.reason, { color: colors.inkMuted }]}>{reason}</Text> : null}
        </View>
    );
};

const styles = StyleSheet.create({
    root: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
    reason: { ...nativeTokens.type.meta, paddingHorizontal: nativeTokens.spacing[3] },
});
