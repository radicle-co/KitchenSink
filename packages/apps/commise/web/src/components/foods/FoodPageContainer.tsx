'use client';

/**
 * The author's food page (`/[locale]/foods/[foodId]`; private foods spec section 5). Orchestration: it mounts the shared
 * food page session (`useFoodPage`) in the design system's `PushedPageFrame` and hands Edit to the app’s edit sheet.
 * Opened from the editor it is a NEW TAB (the editor’s draft stays where the cook left it), so Back goes to My recipes;
 * the title is the food’s name, wrapping between words. It starts at the gutter the shell gives (left-aligned, buildSpec
 * 1.3), and Back is the pinned bar below 840 and the header’s eyebrow from it.
 *
 * ⚠️ The address is a one-way door: it is linked and bookmarked, so renaming it later costs redirects.
 *
 * @pattern Facade — one route over the shared food page session and view
 */
import { FoodEditSheet, FoodPageView, foodPageMessages, useFoodPage } from '@commise/features-recipes/food-page';
import { useMessages } from '@commise/i18n/react';
import { useIsOffline } from '@commise/query';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, type FC } from 'react';

import { withBasePath } from '@/lib/basePath';

/** Props for {@link FoodPageContainer}. */
export interface FoodPageContainerProps {
    readonly foodId: string;
    readonly locale: string;
}

/** The food page. */
export const FoodPageContainer: FC<FoodPageContainerProps> = ({ foodId, locale }) => {
    const m = useMessages(foodPageMessages);
    const router = useRouter();
    const headingId = useId();
    const recipesPath = `/${locale}/recipes`;
    const session = useFoodPage(foodId, { offline: useIsOffline() });
    const title = 'food' in session.state ? (session.state.food.name ?? m.titleFallback) : m.titleFallback;
    const back = {
        label: m.back.label,
        parent: m.back.parent,
        href: withBasePath(recipesPath),
        onPress: () => router.push(recipesPath as Route),
    };

    return (
        <PushedPageFrame back={back} headingId={headingId} title={title}>
            {() => (
                <div className="flex w-full max-w-list flex-col gap-4 pb-8">
                    <LargeTitleHeader headingId={headingId} title={title} back={back} />
                    <FoodPageView {...session} onLeave={() => router.push(recipesPath as Route)} />
                    <FoodEditSheet session={session.edit} />
                </div>
            )}
        </PushedPageFrame>
    );
};
