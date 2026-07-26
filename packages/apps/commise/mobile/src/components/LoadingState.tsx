/**
 * @module components/LoadingState — the mobile app's shared, self-describing loading affordance.
 *
 * A bare `ActivityIndicator` is a nameless spinning shape: assistive tech announces nothing, and a sighted
 * viewer cannot distinguish "fetching your recipe" from "wedged". Every mobile loading surface therefore
 * renders through THIS component, which owns the one accessibility decision they share:
 *
 *  - the wrapper is a single accessibility element (`accessible` + `progressbar` role) named by the CALLER's
 *    contextual, localized label, so the announcement says what is loading;
 *  - the spinner itself is hidden from assistive tech (`aria-hidden`) — react-native-web exposes an
 *    `ActivityIndicator` as its own unnamed `progressbar`, and a second nameless progress element beside the
 *    labelled one is noise;
 *  - the same label doubles as a VISIBLE caption, because a spinner alone gives a sighted viewer no context
 *    either.
 *
 * Pure render component: label in, affordance out.
 */
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/** Props for {@link LoadingState}. */
export interface LoadingStateProps {
    /**
     * Localized, CONTEXTUAL description of what is loading (e.g. "Loading recipe…"). Becomes both the
     * accessible name of the progress affordance and its visible caption — never a generic "Loading".
     */
    readonly label: string;
}

/**
 * A centred, named loading affordance.
 *
 * @param props - The localized `label` describing what is loading.
 * @returns The spinner plus its visible caption, exposed as one named `progressbar`.
 */
export function LoadingState({ label }: LoadingStateProps): JSX.Element {
    return (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.container}>
            <View aria-hidden>
                <ActivityIndicator color={palette.seafoam} />
            </View>
            <Text style={styles.caption}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[3],
        padding: nativeTokens.spacing[5],
    },
    caption: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate, textAlign: 'center' },
});
