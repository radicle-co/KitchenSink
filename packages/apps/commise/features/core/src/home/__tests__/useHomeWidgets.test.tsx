/**
 * What Home draws, once for both apps: discovery → curation → one slot decision per widget. The decision cases were
 * pinned twice, in `HomeWidgetSurface.test.tsx` and `HomeWidgetSurface.native.test.tsx` (the bespoke slot, the
 * placeholder through its loader seam, the skipped live id, placeholders grouped apart); they run here against the
 * hook, and the apps keep only what they draw around it.
 */
import { renderHook } from '@testing-library/react';
import { createContainer, type Container } from 'ditox';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { registerHomeWidget } from '../../appShell.js';
import type { HomeWidgetDescriptor } from '../../contract.js';
import { homeWidgetSlotOf } from '../homeWidgetSlot.js';
import { useHomeWidgets } from '../useHomeWidgets.js';

const Recipe: ComponentType = () => null;
const load = () => Promise.resolve({ default: (): null => null });

const live = (id: string, minTier?: string): HomeWidgetDescriptor => ({
    id,
    load,
    defaultWeight: 1,
    ...(minTier === undefined ? {} : { minTier }),
});
const placeholder = (id: string, capability = `${id}-capability`): HomeWidgetDescriptor => ({
    kind: 'placeholder',
    id,
    capability,
    load,
    defaultWeight: 1,
});

const containerWith = (...descriptors: readonly HomeWidgetDescriptor[]): Container => {
    const container = createContainer();

    for (const descriptor of descriptors) {
        registerHomeWidget(container, descriptor);
    }

    return container;
};

describe('homeWidgetSlotOf', () => {
    it('draws a live widget through its bespoke renderer', () => {
        const descriptor = live('recipes');

        expect(homeWidgetSlotOf(descriptor, { recipes: Recipe })).toStrictEqual({
            kind: 'bespoke',
            descriptor,
            Widget: Recipe,
        });
    });

    it('draws a placeholder through its loader seam, never the renderer map', () => {
        const descriptor = placeholder('meal-plan');

        expect(homeWidgetSlotOf(descriptor, {})).toStrictEqual({ kind: 'placeholder', descriptor });
    });

    it('prefers a bespoke renderer even for an id that is a placeholder (a feature taking its slot over)', () => {
        expect(homeWidgetSlotOf(placeholder('meal-plan'), { 'meal-plan': Recipe })?.kind).toBe('bespoke');
    });

    it('SKIPS a live widget with no renderer on this client (graceful version skew)', () => {
        expect(homeWidgetSlotOf(live('mystery'), { recipes: Recipe })).toBeUndefined();
    });
});

describe('useHomeWidgets', () => {
    const input = {
        renderers: { recipes: Recipe },
        liveCapabilities: ['recipes-capability'] as readonly string[],
        paidFeatures: 'upsell',
    };

    it('leads with the live widgets and groups the placeholders apart', () => {
        const container = containerWith(live('recipes'), placeholder('meal-plan'), placeholder('nutrition'));

        const { result } = renderHook(() => useHomeWidgets({ ...input, container }));

        expect(result.current.live.map((slot) => slot.descriptor.id)).toStrictEqual(['recipes']);
        expect(result.current.comingSoon.map((slot) => slot.descriptor.id).sort()).toStrictEqual([
            'meal-plan',
            'nutrition',
        ]);
    });

    it('draws no placeholder once its capability is live, and the real widget takes the id', () => {
        const container = containerWith(live('meal-plan'), placeholder('meal-plan', 'meal-plan-capability'));

        const { result } = renderHook(() =>
            useHomeWidgets({
                container,
                renderers: { 'meal-plan': Recipe },
                liveCapabilities: ['meal-plan-capability'],
                paidFeatures: 'upsell',
            }),
        );

        expect(result.current.comingSoon).toStrictEqual([]);
        expect(result.current.live.map((slot) => slot.kind)).toStrictEqual(['bespoke']);
    });

    it('drops a live widget with no renderer instead of returning a slot nothing can draw', () => {
        const container = containerWith(live('recipes'), live('mystery'));

        const { result } = renderHook(() => useHomeWidgets({ ...input, container }));

        expect(result.current.live.map((slot) => slot.descriptor.id)).toStrictEqual(['recipes']);
    });

    it('gates a pro widget on the paid-feature state: only granted reaches it', () => {
        const container = containerWith(live('recipes'), live('pro-widget', 'pro'));
        const renderers = { recipes: Recipe, 'pro-widget': Recipe };
        const idsFor = (paidFeatures: string): readonly string[] =>
            renderHook(() => useHomeWidgets({ ...input, container, renderers, paidFeatures })).result.current.live.map(
                (slot) => slot.descriptor.id,
            );

        expect(idsFor('granted')).toContain('pro-widget');
        expect(idsFor('upsell')).not.toContain('pro-widget');
        expect(idsFor('loading')).not.toContain('pro-widget');
    });

    it('answers the same slots across re-renders until an input changes', () => {
        const container = containerWith(live('recipes'));

        const { result, rerender } = renderHook(() => useHomeWidgets({ ...input, container }));
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
