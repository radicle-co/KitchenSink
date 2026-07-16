/**
 * Home screen (mobile). The thin post-login landing that composes the {@link HomeWidgetSurface} host under
 * the top safe-area inset, and wires the recipe widget's "see all recipes" affordance to the navigator's
 * `onOpenRecipes` intent. It owns no widget logic itself — the surface resolves, curates, and renders the
 * registered Home widgets; this screen only supplies the device chrome (status-bar inset) and navigation.
 */
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@commise/ui';

import { HomeWidgetSurface } from '../components/home/index.js';

/** Props for {@link HomeScreen}. */
export interface HomeScreenProps {
    /** Navigate to the full recipes surface (wired by the root navigator). */
    readonly onOpenRecipes: () => void;
    /** Navigate to the account/profile surface (wired by the root navigator). */
    readonly onOpenProfile: () => void;
}

/**
 * The Home landing screen.
 *
 * @param props - The `onOpenRecipes` and `onOpenProfile` navigation intents.
 * @returns The Home widget surface under the top safe-area inset.
 */
export function HomeScreen({ onOpenRecipes, onOpenProfile }: HomeScreenProps): JSX.Element {
    const insets = useSafeAreaInsets();

    // Apply the top safe-area inset so the top bar clears the status bar (without it the top row renders
    // UNDER the status bar — a visual defect, and the occluded nodes drop out of the accessibility hierarchy,
    // which also makes them invisible to screen readers and to Maestro E2E).
    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <HomeWidgetSurface onSeeAllRecipes={onOpenRecipes} onOpenAccount={onOpenProfile} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.sand },
});
