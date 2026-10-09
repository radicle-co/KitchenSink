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
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({ onCreate, headingFocusSignal, children }) => {
    const { list } = useMessages(collectionMessages);
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <Text ref={headingRef} accessibilityRole="header" style={styles.heading}>
                    {list.heading}
                </Text>
                <Button icon="plus" onPress={onCreate}>
                    {list.createCta}
                </Button>
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
});
