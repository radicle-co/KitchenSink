/**
 * @module @commise/features-recipes — native collection-list FRAME (presentational).
 *
 * The React Native leaf of `CollectionListFrame`: the heading and the create action, pinned above whatever the list's
 * suspense boundary renders as `children`, so a pending or failed read never unmounts them. It fetches nothing.
 *
 * When `headingFocusSignal` advances — a retry from the refresh notice inside the boundary succeeded and removed the
 * button the viewer pressed — the screen-reader cursor moves to the heading.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({ onCreate, headingFocusSignal, children }) => {
    const { list } = useMessages(collectionMessages);
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text ref={headingRef} accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={list.createCta}
                    onPress={onCreate}
                    style={styles.createButton}
                >
                    <Text style={styles.createLabel}>{list.createCta}</Text>
                </Pressable>
            </View>
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.charcoal },
    createButton: {
        backgroundColor: palette.seafoam,
        borderRadius: nativeTokens.radius.full,
        paddingVertical: 10,
        paddingHorizontal: 18,
        minHeight: 44,
        justifyContent: 'center',
    },
    createLabel: { color: palette.white, fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
});
