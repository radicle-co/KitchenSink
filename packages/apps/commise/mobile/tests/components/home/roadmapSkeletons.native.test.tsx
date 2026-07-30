/**
 * Component tests for the mobile roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Rendered
 * via react-native-web under jsdom.
 *
 * The red line these lock in: a placeholder shows the real widget's HEADING and a visible "Coming soon", but
 * NEVER fabricated data — so they assert the absence of every number/label the mockup renders from real data
 * (a hard-coded "1,240 of 2,000 cal" reads as real). They also pin platform parity: a native skeleton exists
 * for every shared roadmap id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
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
    nutrition: { Component: NutritionWidgetSkeleton, title: "Today's Nutrition" },
    'resume-cooking': { Component: ResumeCookingWidgetSkeleton, title: 'Resume cooking' },
    'meal-plan': { Component: MealPlanWidgetSkeleton, title: "This Week's Meals" },
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

    it('states "Coming soon" visibly — a grey shape alone reads as a stuck loading state', () => {
        renderIn(<Component />);

        expect(screen.getByText('Coming soon')).toBeTruthy();
    });

    it('exposes no interactive control — a placeholder must not offer an action that cannot work', () => {
        renderIn(<Component />);

        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('presents the placeholder on a frosted-glass card (U8 shared GlassCard surface)', () => {
        const { container } = renderWithProviders(<Component />);

        // The GlassCard primitive renders through `expo-blur`'s `BlurView` — under jsdom that is the stub,
        // marked `data-commise-stub="blur-view"`. The real widget heading lives INSIDE that frosted surface,
        // so a regression that dropped the primitive back to a plain `View` fails here.
        const card = container.querySelector('[data-commise-stub="blur-view"]');

        expect(card).not.toBeNull();
        expect(card?.textContent).toContain(title);
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

        // The weekday names are REAL data (only the meal is unknown), so all seven must be present.
        for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
            expect(screen.getByText(day)).toBeTruthy();
        }
    });
});
