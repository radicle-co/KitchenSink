/**
 * @module @commise/features-recipes — the native photo carousel's paging chevrons: the strip, with a "Previous" disc at
 * its start side and a "Next" disc at its end side, each drawn only when there is a photo to go to. They sit over the
 * photo, centred on the strip's height (`RecipeDetailAndroid384`).
 *
 * Presentational: props to JSX. The page and the scroll belong to the carousel.
 */
import { useMessages } from '@commise/i18n/react';
import { HeroButton } from '@commise/ui/hero-button';
import type { FC, ReactNode } from 'react';
import { styled, YStack } from 'tamagui';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';

/** One chevron's slot: the strip's full height, the chevron centred on it, at one side. */
const ChevronSlot = styled(YStack, {
    name: 'PhotoChevronSlot',
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',

    variants: {
        side: {
            start: { left: '$2' },
            end: { right: '$2' },
        },
    } as const,
});

/** Props for {@link PhotoPagingChevrons}. */
export interface PhotoPagingChevronsProps {
    /** The page the strip is on, from zero. */
    readonly page: number;
    /** How many photos the strip holds. */
    readonly count: number;
    /** The recipe title, for the chevrons' names. */
    readonly title: string;
    /** Go to a page. */
    readonly onGo: (page: number) => void;
    /** The strip the chevrons sit over. */
    readonly children: ReactNode;
}

/** The strip with its paging chevrons. */
export const PhotoPagingChevrons: FC<PhotoPagingChevronsProps> = ({ page, count, title, onGo, children }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <YStack>
            {children}
            {count > 1 && page > 0 && (
                <ChevronSlot side="start">
                    <HeroButton
                        icon="chevronLeft"
                        label={fillTemplate(detail.photoPrevious, { title })}
                        onPress={() => onGo(page - 1)}
                    />
                </ChevronSlot>
            )}
            {count > 1 && page < count - 1 && (
                <ChevronSlot side="end">
                    <HeroButton
                        icon="chevronRight"
                        label={fillTemplate(detail.photoNext, { title })}
                        onPress={() => onGo(page + 1)}
                    />
                </ChevronSlot>
            )}
        </YStack>
    );
};
