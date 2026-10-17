/**
 * Component tests for the mobile roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Rendered
 * via react-native-web under jsdom.
 *
 * The red line these lock in: a placeholder shows the real widget's HEADING and a visible "Coming soon", but
 * NEVER fabricated data — so they assert the absence of every number/label the mockup renders from real data
 * (a hard-coded "1,240 of 2,000 cal" reads as real). They also pin platform parity: a native skeleton exists
 * for every shared roadmap id.
 *
 * ## What this harness can and cannot observe
 *
 * react-native-web drops RN's `accessible` prop entirely, so the "these are ONE accessibility element" half of
 * the grouping fix (#140) is not assertable here — what IS assertable, and is asserted, is that the `header`
 * role sits on the element that contains BOTH strings rather than on the title alone. The merge itself is a
 * device behaviour; it belongs to the Maestro/on-device tier.
 *
 * The SHAPE-hiding half used to be unobservable for the same reason (RNW drops `accessibilityElementsHidden`
 * and `importantForAccessibility` — measured: a `View` carrying both emits no DOM attribute at all), and that
 * blind spot hid a real defect: the shell wrapped ALL children in the hidden subtree, so `MealPlanWidgetSkeleton`
 * silenced its seven REAL weekday names on device while its own JSDoc said they "stay exposed". The skeletons now
 * spell the hiding `aria-hidden`, which React Native reverse-maps to BOTH platform props
 * (`View.js` sets `accessibilityElementsHidden = ariaHidden` and `importantForAccessibility =
 * 'no-hide-descendants'`), so device behaviour is unchanged AND react-native-web emits the attribute — which is
 * what lets the two tests below assert the split by information content instead of trusting it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { FC } from 'react';

import { ROADMAP_WIDGET_IDS, type RoadmapWidgetId } from '@commise/features-core';
import { renderWithProviders } from '@commise/test-utils';

import { MealPlanWidgetSkeleton } from '../../../src/components/home/skeletons/MealPlanWidgetSkeleton.js';
import { NutritionWidgetSkeleton } from '../../../src/components/home/skeletons/NutritionWidgetSkeleton.js';
import { ResumeCookingWidgetSkeleton } from '../../../src/components/home/skeletons/ResumeCookingWidgetSkeleton.js';

afterEach(cleanup);

const renderIn = (ui: React.ReactElement): void => {
    renderWithProviders(ui);
};

const SKELETONS: Readonly<Record<RoadmapWidgetId, { readonly Component: FC; readonly title: string }>> = {
    nutrition: { Component: NutritionWidgetSkeleton, title: 'Today’s nutrition' },
    'resume-cooking': { Component: ResumeCookingWidgetSkeleton, title: 'Resume cooking' },
    'meal-plan': { Component: MealPlanWidgetSkeleton, title: 'This week’s meals' },
};

describe('roadmap skeletons (mobile) — parity with the shared roadmap registry', () => {
    it('provides a native skeleton for EVERY roadmap widget id (a missing one would render nothing)', () => {
        expect(Object.keys(SKELETONS).sort()).toEqual([...ROADMAP_WIDGET_IDS].sort());
    });
});

describe.each(Object.entries(SKELETONS))('%s skeleton (mobile)', (_id, { Component, title }) => {
    it('renders the real widget heading, so the viewer knows what is coming', () => {
        renderIn(<Component />);

        expect(screen.getByText(title)).toBeTruthy();
    });

    it('states "Soon" visibly — a grey shape alone reads as a stuck loading state', () => {
        renderIn(<Component />);

        // Home's one "Coming soon" heading sits above the group, so each card's badge is the short "Soon" (§4.2).
        expect(screen.getByText('Soon')).toBeTruthy();
    });

    it('exposes no interactive control — a placeholder must not offer an action that cannot work', () => {
        renderIn(<Component />);

        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    // #140 — the card was two unrelated accessibility nodes: the heading, and a bare "Coming soon" that a
    // screen-reader user could land on with nothing to attribute it to. Web already groups the pair inside a
    // `<section aria-labelledby>` region; native has no region landmark, so the RN equivalent is to make the
    // header row ONE accessibility element (`accessible`) that still carries the header role — so the widget is
    // announced as a unit, in one swipe, and stays reachable through the heading rotor.
    it('announces the title and "Soon" as ONE unit, so neither is stranded out of context', () => {
        renderIn(<Component />);

        const heading = screen.getByRole('heading');

        expect(within(heading).getByText(title)).toBeTruthy();
        expect(within(heading).getByText('Soon')).toBeTruthy();
    });

    it('leaves the heading unit out of the grey shapes (the shapes carry no information)', () => {
        const { container } = renderWithProviders(<Component />);

        // The shapes live in their own hidden subtree; the announced unit must not have swallowed them, or the
        // one swipe would read a wall of empty placeholders.
        const heading = screen.getByRole('heading');
        expect(container.contains(heading)).toBe(true);
        expect(heading.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('hides the grey shapes from assistive tech, and hides NOTHING that carries words', () => {
        const { container } = renderWithProviders(<Component />);

        // `Array.from`, not a spread: this package's `lib` omits `dom.iterable`, so a `NodeList` is not iterable.
        const hidden = Array.from(container.querySelectorAll('[aria-hidden="true"]'));

        // Half one: the shapes ARE hidden. They are a picture of a layout — announced, they read as a wall of
        // empty placeholders, and `aria-busy` would be a lie because nothing is loading.
        expect(hidden.length, 'no skeleton shape is hidden from assistive tech').toBeGreaterThan(0);

        // Half two: nothing WORDED is hidden. This is the assertion that fails if a future edit reaches for the
        // convenient blanket wrapper around the card's children — which is exactly how the meal-plan weekday
        // names came to be silenced on device.
        for (const node of hidden) {
            expect(node.textContent, 'a hidden subtree swallowed real text').toBe('');
        }
    });

    it('presents the placeholder on the level-1 card, never glass (D12; dark mode read 1.0:1 on glass, F1)', () => {
        const { container } = renderWithProviders(<Component />);

        // A translucent white glass tier had no dark value and put light ink on light glass. The card is now a plain
        // `View` filled with the `paper` role, so nothing here renders through `expo-blur`.
        expect(container.querySelector('[data-commise-stub="blur-view"]')).toBeNull();
        expect(screen.getByText(title)).toBeTruthy();
    });
});

describe('roadmap skeletons (mobile) — no fake data (the CR-001 red line)', () => {
    it('the nutrition skeleton shows no calorie figures, percentage, or macro labels', () => {
        renderIn(<NutritionWidgetSkeleton />);

        expect(screen.queryByText(/\d/u)).toBeNull();
        expect(screen.queryByText(/cal/iu)).toBeNull();
        expect(screen.queryByText(/%/u)).toBeNull();
    });

    it('the resume-cooking skeleton shows no recipe title, progress figure, or Continue action', () => {
        renderIn(<ResumeCookingWidgetSkeleton />);

        expect(screen.queryByText(/\d/u)).toBeNull();
        expect(screen.queryByText(/continue/iu)).toBeNull();
    });

    it('names the day tiles with real, locale-formatted weekday names but shows no meals', () => {
        renderIn(<MealPlanWidgetSkeleton />);

        // The weekday names are REAL data (only the meal is unknown), so all seven are announced by their full
        // name. A phone draws the narrow name ("M"), so seven tiles fit the width with no sideways scroller (F16).
        for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
            expect(screen.getByLabelText(day)).toBeTruthy();
        }
    });

    // The web leaf refuses to wrap the card's children precisely because of this skeleton; the native shell did
    // wrap them, so all seven weekday names — REAL, locale-formatted data this module's JSDoc promises "stay
    // exposed to assistive tech" — were silenced on device. Only the MEAL is unknown, so only the meal hides.
    it('exposes the REAL weekday names while hiding only the unknown meal thumbnails', () => {
        const { container } = renderWithProviders(<MealPlanWidgetSkeleton />);

        // One hidden thumbnail per day tile — the unknown, and nothing else on the strip.
        expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(7);

        for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
            expect(
                screen.getByLabelText(day).closest('[aria-hidden="true"]'),
                `${day} is inside a hidden subtree — a screen-reader user cannot read the week`,
            ).toBeNull();
        }
    });

    it('lays the week out as seven tiles in one row, with no horizontal scroller (F16)', () => {
        const { container } = renderWithProviders(<MealPlanWidgetSkeleton />);

        // react-native-web renders a horizontal ScrollView with `overflow-x: auto`; the strip is a plain row now.
        const scrollers = Array.from(container.querySelectorAll<HTMLElement>('div')).filter((node) =>
            ['auto', 'scroll'].includes(getComputedStyle(node).overflowX),
        );

        expect(scrollers).toHaveLength(0);
    });
});
