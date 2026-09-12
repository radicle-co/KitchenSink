/**
 * @module @commise/features-recipes — native recipe clone action (T075 building block).
 *
 * The React Native leaf of `RecipeCloneAction` — same controlled
 * contract: a clone button disabled when cloning is not allowed (`!canClone`) or in flight (`cloning`) and
 * marked busy while cloning. The source-attribution line MOVED to `detail/RecipeSourceLine.native` — see
 * the web leaf's module doc for why rendering provenance from a clone control was the wrong home.
 *
 * ## Why this IS the design-system `Button` now
 *
 * This leaf used to hand-roll a solid-coral pill, on the stated grounds that "the clone action is painted CORAL
 * in the product's visual language, and the DS variant set has exactly three tiers … none is coral". The
 * premise was never true, and the web leaf carried the identical claim, so the two reinforced each other:
 *
 *  - **No mockup contains a clone action at all** (zero occurrences of clone/duplicate/fork across all nine
 *    screens), so no design ever specified this control's colour — the coral was invented here.
 *  - **The mockups never fill a button coral**: their coral button form is a bordered outline that fills only on
 *    hover; the one solid `bg-coral` in any mockup is a selected allergy chip.
 *  - **Coral's documented role is "Destructive/secondary actions, highlights, warm accents"** and the mockups
 *    spend it on the Danger Zone and the allergy warning — so a filled-coral pill placed a safe, additive,
 *    reversible action in the danger register.
 *
 * Clone is a quiet SECONDARY action (the discovery-card leaf's own styles say precisely that), so both platform
 * leaves now wear the DS `secondary` tier in ONE change and cannot drift apart again. Everything the previous
 * comment promised the hand-rolled version preserved — the 44pt touch floor, the shared radius/spacing scale,
 * a real busy announcement — now comes from the Button itself, and the tests that used to guard the hand-rolled
 * copy are kept, pointed at the DS surface, so the migration cannot quietly lose any of it.
 *
 * A coral/accent tier was deliberately NOT added: a new public `ButtonVariant` for one call site is a YAGNI
 * violation. The real question this surfaced is app-wide — `semantic.secondary` IS `palette.coral`, yet the
 * Button's `secondary` tier paints a grey-bordered white pill while every non-primary mockup button is
 * coral-outlined. Fixing that one tier recolours this control for free.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CloneIcon } from './icons.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeCloneActionProps } from './model.js';

export const RecipeCloneAction: FC<RecipeCloneActionProps> = ({ canClone, cloning = false, onClone }) => {
    const { clone } = useMessages(recipeActionMessages);

    return (
        <View style={styles.wrap}>
            {/* `busy` supplies the in-place `ActivityIndicator`, the disabled in-flight guard (so the clone
                cannot be double-fired), and the `accessibilityState.busy` announcement VoiceOver/TalkBack read. */}
            <Button variant="secondary" icon={<CloneIcon />} disabled={!canClone} busy={cloning} onPress={onClone}>
                {clone.clone}
            </Button>
            {cloning && <Text style={styles.attribution}>{clone.cloningLabel}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    // `alignItems: 'flex-start'` keeps the pill hugging its label rather than stretching to the footer width —
    // the job the removed `alignSelf: 'flex-start'` did on the hand-rolled surface.
    wrap: { gap: nativeTokens.spacing[2], alignItems: 'flex-start' },
    attribution: { fontSize: 13, color: palette.slate },
});
