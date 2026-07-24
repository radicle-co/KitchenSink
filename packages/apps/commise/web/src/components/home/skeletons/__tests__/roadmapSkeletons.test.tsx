// @vitest-environment jsdom
/**
 * Component tests for the roadmap skeleton placeholders (web).
 *
 * Requirement map:
 *  - FR-046 / R6 (as amended by CR-001) — a widget whose feature (005–009) has not shipped renders as a
 *    SKELETON PLACEHOLDER: the real widget's shape with skeleton blocks where data would be.
 *  - **Fake data must never appear.** A hard-coded "1,240 of 2,000 cal" reads as real to a viewer, so these
 *    tests assert the ABSENCE of every number and label the mockup shows for real data. This is the test that
 *    must fail if someone "helpfully" fills a skeleton in.
 *  - WCAG 2.1 AA (1.1.1, 1.3.1, 4.1.2) — a screen-reader user must be told the same thing a sighted user is
 *    told: the panel exists and is coming soon. It must NOT be told there is nutrition data.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ROADMAP_WIDGET_IDS, type RoadmapWidgetId } from '@commise/features-core';
import { renderWithProviders } from '@commise/test-utils';

import { MealPlanWidgetSkeleton } from '../MealPlanWidgetSkeleton';
import { NutritionWidgetSkeleton } from '../NutritionWidgetSkeleton';
import { ResumeCookingWidgetSkeleton } from '../ResumeCookingWidgetSkeleton';

afterEach(cleanup);

const renderIn = (ui: React.ReactElement): void => {
    renderWithProviders(ui);
};

/** Every roadmap skeleton, keyed by its widget id and paired with the heading the mockup shows. */
const SKELETONS: Readonly<Record<RoadmapWidgetId, { readonly Component: React.FC; readonly title: string }>> = {
    nutrition: { Component: NutritionWidgetSkeleton, title: "Today's Nutrition" },
    'resume-cooking': { Component: ResumeCookingWidgetSkeleton, title: 'Resume cooking' },
    'meal-plan': { Component: MealPlanWidgetSkeleton, title: "This Week's Meals" },
};

describe('roadmap skeletons — parity with the shared roadmap registry', () => {
    it('provides a web skeleton for EVERY roadmap widget id (a missing one would render nothing)', () => {
        expect(Object.keys(SKELETONS).sort()).toEqual([...ROADMAP_WIDGET_IDS].sort());
    });
});

describe.each(Object.entries(SKELETONS))('%s skeleton', (_id, { Component, title }) => {
    it('renders the real widget heading, so the viewer knows what is coming', () => {
        renderIn(<Component />);

        expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    });

    it('labels the region with the widget heading', () => {
        renderIn(<Component />);

        expect(screen.getByRole('region', { name: title })).toBeTruthy();
    });

    it('states "Coming soon" VISIBLY — a grey shape alone reads as a stuck loading state', () => {
        renderIn(<Component />);

        // Not sr-only: a sighted viewer must be told this is not loading, exactly as a screen-reader user is.
        expect(within(screen.getByRole('region', { name: title })).getByText('Coming soon')).toBeTruthy();
    });

    it('does NOT claim to be busy — nothing is loading, so aria-busy would be a lie', () => {
        renderIn(<Component />);

        expect(screen.getByRole('region', { name: title }).getAttribute('aria-busy')).toBeNull();
    });

    it('exposes no interactive control — a placeholder must not offer an action that cannot work', () => {
        renderIn(<Component />);

        const region = screen.getByRole('region', { name: title });

        expect(within(region).queryAllByRole('button')).toHaveLength(0);
        expect(within(region).queryAllByRole('link')).toHaveLength(0);
    });

    it('hides its skeleton shapes from assistive tech (they carry no information)', () => {
        const { container } = renderWithProviders(<Component />);

        const shapes = container.querySelectorAll('.bg-pearl');

        expect(shapes.length).toBeGreaterThan(0);

        for (const shape of shapes) {
            expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
        }
    });

    it('does not animate — a pulse means "loading", and this is not loading', () => {
        const { container } = renderWithProviders(<Component />);

        // Also sidesteps prefers-reduced-motion entirely: there is no motion to reduce.
        expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    });
});

describe('roadmap skeletons — no fake data (the CR-001 red line)', () => {
    it('the nutrition skeleton shows no calorie figures, percentage, or macro labels', () => {
        renderIn(<NutritionWidgetSkeleton />);

        const region = screen.getByRole('region', { name: "Today's Nutrition" });

        // Every value the mockup renders from real data must be absent.
        expect(region.textContent).not.toMatch(/\d/u);
        expect(within(region).queryByText(/cal/iu)).toBeNull();
        expect(within(region).queryByText(/calories/iu)).toBeNull();
        expect(within(region).queryByText(/%/u)).toBeNull();
    });

    it('the resume-cooking skeleton shows no recipe title, progress figure, or Continue action', () => {
        renderIn(<ResumeCookingWidgetSkeleton />);

        const region = screen.getByRole('region', { name: 'Resume cooking' });

        expect(region.textContent).not.toMatch(/\d/u);
        expect(within(region).queryByText(/mediterranean/iu)).toBeNull();
        expect(within(region).queryByRole('button', { name: /continue/iu })).toBeNull();
    });

    it('the meal-plan skeleton shows day tiles but no meals, and no "See all" that goes nowhere', () => {
        renderIn(<MealPlanWidgetSkeleton />);

        const region = screen.getByRole('region', { name: "This Week's Meals" });

        expect(within(region).queryByRole('link', { name: /see all/iu })).toBeNull();
        expect(within(region).queryByRole('button', { name: /see all/iu })).toBeNull();
    });

    it('renders seven day tiles, mirroring the real widget shape', () => {
        renderIn(<MealPlanWidgetSkeleton />);

        // The shape is the point of a skeleton: a week is seven tiles, not "some boxes". The tiles are a
        // real list (not aria-hidden shapes) because a weekday name is REAL data — only the meal is unknown.
        expect(screen.getAllByRole('listitem')).toHaveLength(7);
    });

    it('names the day tiles with real, locale-formatted weekday names (not invented content)', () => {
        renderIn(<MealPlanWidgetSkeleton />);

        const days = screen.getAllByRole('listitem').map((item) => item.textContent);

        expect(days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    });
});
