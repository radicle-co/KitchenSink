/**
 * Home screen (mobile). The thin post-login landing that composes the {@link HomeWidgetSurface} host under
 * the top safe-area inset, and wires the recipe widget's two navigation affordances to the navigator's intents:
 * "see all recipes" → `onOpenRecipes`, and a "Recent recipes" CARD tap → `onOpenRecipe` (that recipe's detail).
 * It owns no widget logic itself — the surface resolves, curates, and renders the registered Home widgets; this
 * screen only supplies the device chrome (status-bar inset) and navigation.
 *
 * ⚠️ So it is PRESENTATIONAL, which a file under `src/screens/` is not expected to be: every other screen
 * here mounts a query or a statechart. This one reads a safe-area inset and passes three callbacks straight
 * through. The child that decides — `HomeWidgetSurface` — is where a read belongs; one added here would be
 * in the wrong place.
 */
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeWidgetSurface } from '../components/home/index.js';

/** Props for {@link HomeScreen}. */
export interface HomeScreenProps {
    /** Navigate to the full recipes surface (wired by the root navigator). */
    readonly onOpenRecipes: () => void;
    /** Navigate straight to one recipe's detail, from a "Recent recipes" card (wired by the root navigator). */
    readonly onOpenRecipe: (recipeId: string) => void;
    /** Navigate to the account/profile surface (wired by the root navigator). */
    readonly onOpenProfile: () => void;
}

/**
 * The Home landing screen.
 *
 * @param props - The `onOpenRecipes`, `onOpenRecipe` and `onOpenProfile` navigation intents.
 * @returns The Home widget surface under the top safe-area inset.
 */
export function HomeScreen({ onOpenRecipes, onOpenRecipe, onOpenProfile }: HomeScreenProps): JSX.Element {
    const insets = useSafeAreaInsets();

    // Apply the top safe-area inset so the top bar clears the status bar (without it the top row renders
    // UNDER the status bar — a visual defect, and the occluded nodes drop out of the accessibility hierarchy,
    // which also makes them invisible to screen readers and to Maestro E2E).
    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <HomeWidgetSurface
                onSeeAllRecipes={onOpenRecipes}
                onSelectRecipe={onOpenRecipe}
                onOpenAccount={onOpenProfile}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    container: { flex: 1, backgroundColor: 'transparent' },
});
