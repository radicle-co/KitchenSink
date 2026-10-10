/**
 * D15 for the app shell and Home's leaves: each paints from colour ROLES at render, so it follows the device's scheme
 * (`docs/design/uiOverhaul/darkTheme.md` §7.3). Asserted in BOTH schemes: a heading in `ink`, secondary copy in
 * `inkMuted`, a skeleton shape in `surfaceMuted`, a card's edge in `lineDivider` (§4), and the meal-plan day tile
 * as `paper` at the alphas it always had.
 *
 * One suite for the nine leaves, because each needs the same double (`withSystemScheme`) and none of their own suites
 * mocks `react-native`.
 */
import { renderWithProviders } from '@commise/test-utils';
import { role, roleDark, tint } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
// The signed-out screens pull Clerk's native SDK; this suite reads only the gate's own blocked state.
vi.mock('../../src/screens/login', () => ({ LoginScreen: () => null }));
vi.mock('../../src/screens/signup', () => ({ SignUpScreen: () => null }));

import { AuthGate } from '../../src/components/AuthGate.js';
import { HomeWidgetErrorNotice } from '../../src/components/home/HomeWidgetErrorNotice.js';
import { MealPlanWidgetSkeleton } from '../../src/components/home/skeletons/MealPlanWidgetSkeleton.js';
import { NutritionWidgetSkeleton } from '../../src/components/home/skeletons/NutritionWidgetSkeleton.js';
import { ResumeCookingWidgetSkeleton } from '../../src/components/home/skeletons/ResumeCookingWidgetSkeleton.js';
import { SubscriptionNudge } from '../../src/components/home/SubscriptionNudge.js';
import { LoadingState } from '../../src/components/LoadingState.js';
import { RootErrorFallback } from '../../src/components/RootErrorFallback.js';
import { useAuth } from '../../src/hooks/useAuth.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const copy = mobileMessages.en;

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

const colourOf = (element: Element): string => getComputedStyle(element).color;

/** Every element painted with a background colour, in document order. */
const filledWith = (container: HTMLElement, colour: string): readonly Element[] =>
    [...container.querySelectorAll('*')].filter((node) => getComputedStyle(node).backgroundColor === colour);

describe.each(['light', 'dark'] as const)('the shell and Home leaves — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;

    it('LoadingState captions its spinner in inkMuted', () => {
        systemScheme.current = scheme;
        render(<LoadingState label="Loading recipe…" />);

        expect(colourOf(screen.getByText('Loading recipe…'))).toBe(rgb(colours.inkMuted));
    });

    it('AuthGate states a blocked session in ink, with its body in inkMuted', () => {
        systemScheme.current = scheme;
        vi.mocked(useAuth).mockReturnValue({
            state: { status: 'blocked', reason: { title: 'Account suspended', body: 'Contact support.' } },
        } as unknown as ReturnType<typeof useAuth>);
        render(
            <AuthGate>
                <></>
            </AuthGate>,
        );

        expect(colourOf(screen.getByText('Account suspended'))).toBe(rgb(colours.ink));
        expect(colourOf(screen.getByText('Contact support.'))).toBe(rgb(colours.inkMuted));
    });

    it('RootErrorFallback titles the crash in ink, with its body in inkMuted', () => {
        systemScheme.current = scheme;
        render(<RootErrorFallback error={new Error('x')} resetErrorBoundary={() => undefined} />);

        expect(colourOf(screen.getByText(copy.common.somethingWentWrong))).toBe(rgb(colours.ink));
        expect(colourOf(screen.getByText(copy.common.rootErrorBodyHome))).toBe(rgb(colours.inkMuted));
    });

    it('HomeWidgetErrorNotice says the failure in inkMuted', () => {
        systemScheme.current = scheme;
        render(<HomeWidgetErrorNotice />);

        expect(colourOf(screen.getByRole('status'))).toBe(rgb(colours.inkMuted));
    });

    it('SubscriptionNudge writes its body in inkMuted', () => {
        systemScheme.current = scheme;
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(colourOf(screen.getByText(copy.home.nudge.body))).toBe(rgb(colours.inkMuted));
    });

    it('a roadmap card titles itself in ink, its badge in inkMuted, inside a lineDivider edge', () => {
        systemScheme.current = scheme;
        renderWithProviders(<NutritionWidgetSkeleton />);
        const title = screen.getByText(copy.home.roadmap.titles.nutrition);

        expect(colourOf(title)).toBe(rgb(colours.ink));
        expect(colourOf(screen.getByText(copy.home.roadmap.comingSoon))).toBe(rgb(colours.inkMuted));

        let card: Element | null = title;

        while (card !== null && getComputedStyle(card).borderTopWidth !== '1px') {
            card = card.parentElement;
        }

        expect(card === null ? undefined : getComputedStyle(card).borderTopColor).toBe(rgb(colours.lineDivider));
    });

    it('the nutrition skeleton draws its ring and bars in surfaceMuted', () => {
        systemScheme.current = scheme;
        const { container } = renderWithProviders(<NutritionWidgetSkeleton />);
        const ring = [...container.querySelectorAll('*')].filter(
            (node) => getComputedStyle(node).borderTopWidth === '4px',
        );

        expect(ring.map((node) => getComputedStyle(node).borderTopColor)).toEqual([rgb(colours.surfaceMuted)]);
        expect(filledWith(container, rgb(colours.surfaceMuted)).length).toBeGreaterThanOrEqual(3);
    });

    it('the resume-cooking skeleton draws its four shapes in surfaceMuted', () => {
        systemScheme.current = scheme;
        const { container } = renderWithProviders(<ResumeCookingWidgetSkeleton />);

        expect(filledWith(container, rgb(colours.surfaceMuted))).toHaveLength(4);
    });

    it('the meal-plan skeleton writes each day in inkMuted on a paper tile, its meal shape in surfaceMuted', () => {
        systemScheme.current = scheme;
        const { container } = renderWithProviders(<MealPlanWidgetSkeleton />);
        const days = filledWith(container, tint(colours.paper, 0.5));

        expect(days).toHaveLength(7);
        expect(days.map((tile) => getComputedStyle(tile).borderTopColor)).toEqual(
            Array.from({ length: 7 }, () => tint(colours.paper, 0.3)),
        );
        expect(filledWith(container, rgb(colours.surfaceMuted))).toHaveLength(7);

        const [firstDay] = days;

        expect(
            firstDay?.firstElementChild === null ? undefined : colourOf(firstDay?.firstElementChild as Element),
        ).toBe(rgb(colours.inkMuted));
    });
});
