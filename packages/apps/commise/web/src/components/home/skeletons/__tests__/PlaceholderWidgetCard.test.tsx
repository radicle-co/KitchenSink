// @vitest-environment jsdom
/**
 * Component tests for the web roadmap placeholder shell (FR-046 / R6 as amended by CR-001, #140).
 *
 * This surface had no component test of its own — only e2e coverage — while carrying the accessibility decision
 * every roadmap placeholder depends on. What it locks in is the contract the NATIVE leaf is measured against
 * (`mobile/tests/components/home/roadmapSkeletons.native.test.tsx`), so the two platforms cannot drift on how a
 * "coming soon" widget presents itself:
 *
 *  - the widget is identifiable as a UNIT — a region named by the real widget's heading;
 *  - "Coming soon" is exposed to everyone (visible content, never `sr-only`, never `aria-hidden`);
 *  - the grey shapes are hidden from assistive tech, because they carry no information;
 *  - nothing claims to be BUSY, because nothing is loading — the feature simply does not exist yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { FC } from 'react';

import { ROADMAP_WIDGET_IDS, type RoadmapWidgetId } from '@commise/features-core';
import { renderWithProviders } from '@commise/test-utils';

import { MealPlanWidgetSkeleton } from '../MealPlanWidgetSkeleton';
import { NutritionWidgetSkeleton } from '../NutritionWidgetSkeleton';
import { PlaceholderWidgetCard } from '../PlaceholderWidgetCard';
import { ResumeCookingWidgetSkeleton } from '../ResumeCookingWidgetSkeleton';

afterEach(cleanup);

const renderCard = () =>
    renderWithProviders(
        <PlaceholderWidgetCard title="Today's Nutrition">
            <div className="h-4 w-full bg-pearl" />
        </PlaceholderWidgetCard>,
    );

describe('PlaceholderWidgetCard (web)', () => {
    it('presents the widget as a region named by the real widget’s heading', () => {
        renderCard();

        // The region is what makes the placeholder addressable as one thing — a screen-reader user can jump to
        // it, and everything inside is attributable to it (native's `accessible` header row is its counterpart).
        const region = screen.getByRole('region', { name: "Today's Nutrition" });

        expect(within(region).getByRole('heading', { name: "Today's Nutrition" })).toBeTruthy();
    });

    it('names the widget exactly once — the region takes its name FROM the heading', () => {
        renderCard();

        // `aria-labelledby` pointing at the heading, rather than a second `aria-label` copy of the title, is
        // what keeps one string in one place (and is why the region and heading are not a duplicate-name pair).
        const region = screen.getByRole('region', { name: "Today's Nutrition" });
        const heading = screen.getByRole('heading', { name: "Today's Nutrition" });

        expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(region.getAttribute('aria-label')).toBeNull();
    });

    it('states "Coming soon" as exposed, visible content — not a screen-reader-only string', () => {
        const { container } = renderCard();

        const badge = screen.getByText('Coming soon');

        expect(badge.className).not.toContain('sr-only');
        expect(badge.closest('[aria-hidden="true"]')).toBeNull();
        expect(container.textContent).toContain('Coming soon');
    });

    it('renders the caller’s shape as-is, without an aria-hidden wrapper of its own', () => {
        const { container } = renderCard();

        // Deliberate: `MealPlanWidgetSkeleton` passes REAL weekday names among its shapes, and `aria-hidden` on
        // an ancestor cannot be undone by a descendant — so hiding is the caller's call, per shape. The three
        // real skeletons are checked for it below. (This shell's JSDoc used to claim the opposite.)
        const shape = container.querySelector('.bg-pearl');

        expect(shape).not.toBeNull();
        expect(shape?.closest('[aria-hidden="true"]')).toBeNull();
    });

    it('never announces itself as BUSY — a roadmap widget is not a pending fetch', () => {
        const { container } = renderCard();

        // `aria-busy` / `role="status"` would make a screen-reader user wait for data that is never coming.
        expect(container.querySelector('[aria-busy]')).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('paints no pulse, so there is no motion for reduce-motion to have to suppress', () => {
        const { container } = renderCard();

        for (const node of container.querySelectorAll('*')) {
            expect(node.getAttribute('class') ?? '').not.toContain('animate-pulse');
        }
    });
});

/**
 * The three real web skeletons — the mirror of `roadmapSkeletons.native.test.tsx`, which the web side lacked
 * entirely. Same red line: the real heading and "Coming soon", the shapes hidden, and NEVER fabricated data.
 */
const SKELETONS: Readonly<Record<RoadmapWidgetId, { readonly Component: FC; readonly title: string }>> = {
    nutrition: { Component: NutritionWidgetSkeleton, title: "Today's Nutrition" },
    'resume-cooking': { Component: ResumeCookingWidgetSkeleton, title: 'Resume cooking' },
    'meal-plan': { Component: MealPlanWidgetSkeleton, title: "This Week's Meals" },
};

describe('roadmap skeletons (web) — parity with the shared roadmap registry', () => {
    it('provides a web skeleton for EVERY roadmap widget id (a missing one would render nothing)', () => {
        expect(Object.keys(SKELETONS).sort()).toEqual([...ROADMAP_WIDGET_IDS].sort());
    });
});

describe.each(Object.entries(SKELETONS))('%s skeleton (web)', (_id, { Component, title }) => {
    it('presents itself as a region named by the real widget heading', () => {
        renderWithProviders(<Component />);

        expect(screen.getByRole('region', { name: title })).toBeTruthy();
    });

    it('states "Coming soon" visibly — a grey shape alone reads as a stuck loading state', () => {
        renderWithProviders(<Component />);

        expect(screen.getByText('Coming soon')).toBeTruthy();
    });

    it('hides EVERY grey shape from assistive tech (a picture of a layout is not content)', () => {
        const { container } = renderWithProviders(<Component />);

        const shapes = [...container.querySelectorAll('[class*="bg-pearl"], [class*="border-pearl"]')];

        expect(shapes.length, 'the skeleton paints no shapes at all').toBeGreaterThan(0);

        for (const shape of shapes) {
            expect(shape.closest('[aria-hidden="true"]'), `shape "${shape.className}" is exposed`).not.toBeNull();
        }
    });

    it('exposes no interactive control — a placeholder must not offer an action that cannot work', () => {
        renderWithProviders(<Component />);

        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('link')).toHaveLength(0);
    });
});

describe('roadmap skeletons (web) — no fake data (the CR-001 red line)', () => {
    it('the nutrition skeleton shows no calorie figures, percentage, or macro labels', () => {
        renderWithProviders(<NutritionWidgetSkeleton />);

        expect(screen.queryByText(/\d/u)).toBeNull();
        expect(screen.queryByText(/cal/iu)).toBeNull();
        expect(screen.queryByText(/%/u)).toBeNull();
    });

    it('the resume-cooking skeleton shows no recipe title, progress figure, or Continue action', () => {
        renderWithProviders(<ResumeCookingWidgetSkeleton />);

        expect(screen.queryByText(/\d/u)).toBeNull();
        expect(screen.queryByText(/continue/iu)).toBeNull();
    });

    it('names the day tiles with real, locale-formatted weekday names but shows no meals', () => {
        renderWithProviders(<MealPlanWidgetSkeleton />);

        // The weekday names are REAL data (only the meal is unknown), so all seven stay EXPOSED — which is
        // precisely why this shell cannot blanket-hide its children.
        for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
            const label = screen.getByText(day);

            expect(label.closest('[aria-hidden="true"]'), `weekday ${day} is hidden from assistive tech`).toBeNull();
        }
    });
});
