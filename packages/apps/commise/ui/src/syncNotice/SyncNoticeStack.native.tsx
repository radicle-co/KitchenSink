/**
 * @module @commise/ui/sync-notice — the native notice stack: the in-flow column above the navigator.
 *
 * ⛔ IT TAKES THE TOP SAFE-AREA INSET WHILE A NOTICE SHOWS (`docs/design/offlineNotice.md` §7). Once mounted above the
 * navigator the notice is the topmost element, and a card drawn under the status bar drops out of the accessibility
 * hierarchy (the reason `HomeScreen` pads its own top). The screens below still pad by the device inset themselves, so
 * while a notice shows there is dead space under it on a notched device; that is the accepted cost until a shared
 * remaining-inset provider exists. With nothing showing the column pads nothing and takes no space.
 *
 * ⛔ IN FLOW, NEVER ABSOLUTE: a sibling in a column gives the screens below less height, so clipping is structurally
 * impossible.
 *
 * A presentational leaf: it renders its children and nothing else.
 *
 * @pattern Adapter over React Native's `View` and the safe-area insets
 */
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nativeTokens } from '../tokens/native.js';
import type { SyncNoticeStackProps } from './props.js';

/** The notices, in a column that owns the top inset while any of them shows. */
export const SyncNoticeStack: FC<SyncNoticeStackProps> = ({ active, children }) => {
    const insets = useSafeAreaInsets();

    return (
        <View collapsable={false} style={[styles.column, active && { paddingTop: insets.top }]}>
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[2] },
});
