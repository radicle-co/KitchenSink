/**
 * Board P6 (plan makePublicRefusalNotice U2, KTD-3 and KTD-6, designer DN-1): the NATIVE recipe page says why a private
 * recipe stays private as one STANDING line, muted and never a live region, and announces it once through a hidden polite
 * region when it first appears. In lock-step with the web cases in `RecipeDetailView.test.tsx`.
 *
 * `Platform.OS` and the announce API are mocked because react-native-web implements neither (the same seam as
 * `photoUploadAnnouncement.native.test.tsx`).
 */
import { guardedFoodClient } from '@commise/test-utils';
import { render as renderInDesignSystem, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import type { FC, ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { idleUnreachableRetry, makeRecipeDetail } from '../../__fixtures__/index.js';
import type { VisibilityNotice } from '../../actions/visibilityNotice.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const platform = vi.hoisted(() => ({
    os: 'ios' as 'ios' | 'android',
    announce: vi.fn<(message: string, options: unknown) => void>(),
}));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        AccessibilityInfo: {
            ...actual.AccessibilityInfo,
            announceForAccessibilityWithOptions: platform.announce,
            sendAccessibilityEvent: vi.fn(),
        },
    };
});

beforeEach(() => {
    platform.os = 'ios';
});

afterEach(() => {
    cleanup();
    platform.announce.mockClear();
});

/** The owner's view also mounts the ambiguity review, which reads the food client. */
const OwnerScope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>{children}</CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

const render = (
    ui: ReactElement,
    wrapper: FC<{ readonly children: ReactNode }> = CookMarksTestProvider,
): ReturnType<typeof renderInDesignSystem> => renderInDesignSystem(ui, { wrapper });

const STANDING = {
    kind: 'standing',
    reason: 'policy.webPage',
    text: 'This recipe stays private because it’s from a web page.',
} as const;
const MOMENT: VisibilityNotice = { kind: 'moment', text: 'We couldn’t change who can see this recipe. Try again.' };

const view = (notice?: VisibilityNotice, announcement?: string, viewerIsOwner = true): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        {...(viewerIsOwner ? { viewerIsOwner } : {})}
        {...(notice === undefined ? {} : { visibilityNotice: notice })}
        {...(announcement === undefined ? {} : { visibilityAnnouncement: announcement })}
        recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })}
    />
);
const announced = (): string[] => platform.announce.mock.calls.map(([message]) => message);
/** The visible line: the node that is not a live region (the hidden polite region holds the same words once announced). */
const visibleLine = (): HTMLElement => screen.getByText(STANDING.text, { selector: ':not([aria-live])' });

describe('RecipeDetailView (native) — the standing reason line (P6)', () => {
    it.each(['light', 'dark'] as const)(
        'shows the line in the muted ink role in the %s scheme, not the danger one',
        (scheme) => {
            renderWithTamagui(<OwnerScope>{view(STANDING)}</OwnerScope>, scheme);

            expect(resolvedColour(visibleLine(), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        },
    );

    it('⛔ never puts the visible line inside a live region', () => {
        render(view(STANDING, STANDING.text), OwnerScope);

        expect(visibleLine().closest('[aria-live]')).toBeNull();
    });

    it('keeps the assertive region mounted and empty while the standing line is shown', () => {
        render(view(STANDING), OwnerScope);

        const regions = document.querySelectorAll('[aria-live="assertive"]');

        expect(regions).toHaveLength(1);
        expect(regions.item(0)?.textContent).toBe('');
    });

    it('announces nothing on a page that opens with the line', () => {
        render(view(STANDING), OwnerScope);

        expect(announced()).toEqual([]);
    });

    it('⛔ iOS: announces the line once, through the polite region that was already mounted, when it arrives', () => {
        const { rerender } = render(view(STANDING), OwnerScope);
        const before = new Set(document.querySelectorAll('[aria-live="polite"]'));

        rerender(view(STANDING, STANDING.text));
        rerender(view(STANDING, STANDING.text));

        expect(announced()).toEqual([STANDING.text]);
        expect(before.size).toBeGreaterThan(0);
        expect([...before].some((node) => node.textContent === STANDING.text)).toBe(true);
    });

    it('says a moment line in the assertive region, and not the standing line', () => {
        render(view(MOMENT), OwnerScope);

        expect(screen.getByRole('alert').textContent).toBe(MOMENT.text);
        expect(screen.queryByText(STANDING.text)).toBeNull();
    });

    it('mounts nothing for another cook, even when handed a line', () => {
        render(view(STANDING, STANDING.text, false));

        expect(screen.queryByText(STANDING.text)).toBeNull();
        expect(announced()).toEqual([]);
    });
});
