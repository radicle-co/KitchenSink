/**
 * @module @commise/features-recipes — the native recipe hero's no-photo band (ADR-0080): the ONE no-photo gradient the cards
 * use (sky to cream, leaning 170 degrees; designer ruling C2), 96 pt tall, alone: no disc and no letter on it (designer,
 * 2026-11-02). Feature-local and TEMPORARY: `RecipeCover` on fix/im-recipescard draws the same gradient at `aspect="band"`, and
 * this file goes when that lands, the hero then rendering `<RecipeCover aspect="band" />`.
 */
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import type { FC } from 'react';
import { styled, YStack } from 'tamagui';

/** The wash fills the band. */
const FILL = { flex: 1 } as const;

const Box = styled(YStack, {
    name: 'HeroBand',
    width: '100%',
    height: nativeTokens.mediaHeight.heroPlaceholder,
    borderRadius: '$lg',
    overflow: 'hidden',
});

/** The no-photo band: presentational (props to JSX), and decorative, because the title below names the recipe. */
export const HeroBand: FC = () => (
    <Box aria-hidden>
        <GradientSurface gradient="cover" style={FILL} />
    </Box>
);
