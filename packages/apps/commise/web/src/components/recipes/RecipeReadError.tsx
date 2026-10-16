'use client';

/**
 * @module components/recipes/RecipeReadError — what the web recipe detail route and the editor render when the recipe
 * read fails: the shared `RecipeLoadError`, with a way back to My recipes.
 *
 * It replaces the web-only `RecipeLoadError` (the same sentences authored a second time, in the app's dictionary) and the
 * detail container's private wrapper: both hosts now share this one. The way back is a real link (a new tab works) and a
 * router push on a plain click.
 *
 * @pattern Adapter — the shared `RecipeLoadError` over Next's router and the route locale
 */
import { recipeActionMessages, recipeMessages } from '@commise/features-recipes';
import { RecipeLoadError } from '@commise/features-recipes/detail';
import { useMessages } from '@commise/i18n/react';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC } from 'react';

/** Props for {@link RecipeReadError}. */
export interface RecipeReadErrorProps {
    /** What the read failed with. */
    readonly error: unknown;
    /** Read again: the boundary's reset. */
    readonly onRetry: () => void;
}

/**
 * The recipe read failed.
 *
 * @param props - What the read failed with, and the boundary's reset.
 * @returns The notice.
 */
export const RecipeReadError: FC<RecipeReadErrorProps> = ({ error, onRetry }) => {
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const { detailActions } = useMessages(recipeActionMessages);
    const { detail } = useMessages(recipeMessages);
    const href = `/${locale}/recipes`;

    return (
        <RecipeLoadError
            error={error}
            onRetry={onRetry}
            back={{
                label: detail.backTo.replace('{parent}', detailActions.backToRecipes),
                icon: 'chevronLeft',
                href,
                onPress: () => router.push(href as Route),
            }}
        />
    );
};
