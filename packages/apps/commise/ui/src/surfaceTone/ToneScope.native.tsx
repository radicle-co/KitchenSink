/**
 * @module @commise/ui/surface-tone — {@link ToneScope}: states a surface's tone ONCE, to both readers of it. Tamagui's
 * `<Theme name={tone}>` makes a bare `Text` and every Tamagui part inside take the tone's ink, background and border
 * (the sub-themes of `theme/tamaguiThemes.ts`); `SurfaceToneScope` makes `useSurfaceTone` and `usePressFill` read the same
 * tone. Two separate statements of one fact can drift, so `Surface` and every root that paints itself state it through
 * here, and a guard (`surfaceToneScopeOwnership`) lets nothing else import the raw scope.
 *
 * The raw scope retires consumer by consumer as the readers move to Tamagui theme keys.
 *
 * Presentational: props → JSX.
 *
 * @pattern Adapter — pairs Tamagui's theme context with the JS tone context behind one component
 */
import type { FC, ReactNode } from 'react';
import { Theme } from 'tamagui';

import type { SurfaceTone } from './surfaceTone.js';
import { SurfaceToneScope } from './surfaceToneContext.js';

/** Props for {@link ToneScope}. */
export interface ToneScopeProps {
    /** The surface's tone. */
    readonly tone: SurfaceTone;
    readonly children?: ReactNode;
}

/** States a tone to everything inside, painting nothing. */
export const ToneScope: FC<ToneScopeProps> = ({ tone, children }) => (
    <Theme name={tone}>
        <SurfaceToneScope tone={tone}>{children}</SurfaceToneScope>
    </Theme>
);
