/**
 * @module @commise/features-recipes/collections — the native twin of the web `CollectionDetailGutter`: a view that pads
 * what it holds 16 pt a side. The collection screen's scroller does not pad its content, because the large title insets
 * itself (padding around it would move it in twice), so each part draws its own gutter: the header pads its own lines
 * and this pads the notice slot, the failure lines and the members.
 *
 * Presentational: props → JSX.
 */
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CollectionDetailGutterProps } from './CollectionDetailGutter.js';

export const CollectionDetailGutter: FC<CollectionDetailGutterProps> = ({ children }) => (
    <View style={styles.gutter}>{children}</View>
);

const styles = StyleSheet.create({
    gutter: { paddingHorizontal: nativeTokens.spacing[4] },
});
