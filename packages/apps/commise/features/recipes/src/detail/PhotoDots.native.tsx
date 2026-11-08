/**
 * @module @commise/features-recipes — the native photo carousel's dots: one per photo, the current page's in `ink` and
 * the others in the divider tone. Each is named for its photo and states whether it is the current one. Drawn only
 * for more than one photo, because a lone dot conveys nothing.
 *
 * Presentational: props to JSX.
 */
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';

const Row = styled(XStack, { name: 'PhotoDots', justifyContent: 'center', gap: '$2' });

/**
 * One dot.
 *
 * @pattern Variant — whether it is the current page is a closed Tamagui variant, not a colour passed in
 */
const Dot = styled(YStack, {
    name: 'PhotoDot',
    width: 8,
    height: 8,
    borderRadius: '$full',
    backgroundColor: '$lineDivider',

    variants: {
        current: {
            true: { backgroundColor: '$ink' },
        },
    } as const,
});

/** Props for {@link PhotoDots}. */
export interface PhotoDotsProps {
    /** The recipe's photos, in display order. */
    readonly photos: readonly RecipePhoto[];
    /** The recipe title, for each dot's name. */
    readonly title: string;
    /** The page the strip is on, from zero. */
    readonly page: number;
}

/** The native photo dots. */
export const PhotoDots: FC<PhotoDotsProps> = ({ photos, title, page }) => {
    const { detail } = useMessages(recipeMessages);

    if (photos.length < 2) {
        return null;
    }

    return (
        <Row collapsable={false} aria-label={detail.photoDotsLabel}>
            {photos.map((photo, index) => (
                <Dot
                    accessible
                    key={photo.id}
                    aria-label={fillTemplate(detail.photoDot, { title, index: index + 1 })}
                    aria-selected={index === page}
                    current={index === page}
                />
            ))}
        </Row>
    );
};
