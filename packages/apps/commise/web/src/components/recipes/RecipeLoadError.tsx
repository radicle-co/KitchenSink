'use client';

/**
 * @module RecipeLoadError — what a recipe read's boundary renders when the read fails: the editor's (new and edit) and
 * the recipe page's. A 404 is final, so it offers no retry; any other failure — including an id that cannot name a
 * recipe, where there is no evidence the recipe is gone — is the generic one, whose retry is the boundary's reset, which
 * refetches. The control is the design system's `Button`, as on native.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { Route } from 'next';
import Link from 'next/link';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeLoadError}. */
export interface RecipeLoadErrorProps {
    /** What the read failed with. */
    readonly error: unknown;
    /** Read again: the boundary's reset. */
    readonly onRetry: () => void;
}

/**
 * Presentational: a recipe read failed (`buildSpec.md` §6.7). The page's heading says what happened, a missing recipe
 * offers no retry, and both states keep a way back to My recipes — the bare two lines it replaces had neither (F18).
 */
export const RecipeLoadError: FC<RecipeLoadErrorProps> = ({ error, onRetry }) => {
    const { recipes } = useMessages(webMessages);
    const locale = useLocale();
    const notFound = isNotFoundError(error);

    return (
        <div role="alert" className="flex max-w-reading flex-col items-start gap-4 py-8">
            <h1 className="text-section-title text-ink">
                {notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
                {notFound ? null : (
                    <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                        {recipes.detail.retry}
                    </Button>
                )}
                <Link href={`/${locale}/recipes` as Route} className={buttonSurfaceClass('ghost')}>
                    <Icon name="chevronLeft" size={16} />
                    {recipes.detail.backToRecipes}
                </Link>
            </div>
        </div>
    );
};
