/**
 * @module @commise/features-recipes/actions — the recipe-action glyphs (React Native leaf of `icons.tsx`).
 *
 * The native idiom of the same glyph set: `@expo/vector-icons` `Feather` names, matched one-to-one to the web
 * leaf's hand-inlined paths. The design-system `Button` hides whatever it is handed from the accessibility
 * tree, so these are decorative and the visible label owns the accessible name.
 */
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC } from 'react';

/** Action-glyph size, matched to the DS Button's `bodySm` label so the icon and text read as one unit. */
const ACTION_ICON_SIZE = 16;

/**
 * Copy — the CLONE affordance's glyph, everywhere it appears.
 *
 * Shared for the same reason the clone controls share one DS tier: "what a clone action looks like" is ONE
 * decision, and the product has three clone affordances that previously disagreed on colour, shape and glyph.
 *
 * The colour is the DS `Button`'s `secondary` FOREGROUND (`palette.charcoal`), because the native Button makes
 * the CALLER supply the icon's colour while owning the label's — so a per-call-site literal is a standing
 * invitation for the glyph and its label to end up different colours. Single-sourcing it here means the three
 * clone controls can only be wrong together, and only in one place. (If the `secondary` tier is ever re-toned
 * — see the open `semantic.secondary === palette.coral` question — this constant moves with it.)
 */
export const CloneIcon: FC = () => <Feather name="copy" size={ACTION_ICON_SIZE} color={palette.charcoal} />;
