// @vitest-environment jsdom
/**
 * Component tests for the web roadmap placeholder slot: it draws whatever skeleton its descriptor's loader resolves,
 * and it resolves that skeleton ONCE per loader.
 *
 * ⛔ The second case is the one that matters. The skeleton component used to be built inside the render with
 * `useMemo(() => dynamic(...), [descriptor])` — a component TYPE created during render, which
 * `react-hooks/static-components` forbids because a new type remounts its whole subtree. The memo also died with
 * the slot, so a remount re-imported the chunk. Keying the built component on the loader outside React keeps one
 * type per loader for the life of the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { HomeWidgetDescriptor } from '@commise/features-core';

import { RoadmapWidgetSlot } from '../RoadmapWidgetSlot';

afterEach(cleanup);

function Skeleton() {
    return <p>meal plan skeleton</p>;
}

const descriptorFor = (load: HomeWidgetDescriptor['load']): HomeWidgetDescriptor =>
    ({
        id: 'meal-plan',
        kind: 'placeholder',
        capability: 'meal-plans',
        defaultWeight: 1,
        load,
    }) as HomeWidgetDescriptor;

describe('RoadmapWidgetSlot (web)', () => {
    it('renders the skeleton its descriptor’s loader resolves', async () => {
        const load = vi.fn(async () => ({ default: Skeleton }));

        render(<RoadmapWidgetSlot descriptor={descriptorFor(load)} />);

        expect(await screen.findByText('meal plan skeleton')).toBeTruthy();
    });

    it('loads the skeleton once per loader, across re-renders and a remount', async () => {
        const load = vi.fn(async () => ({ default: Skeleton }));
        const descriptor = descriptorFor(load);

        const { rerender, unmount } = render(<RoadmapWidgetSlot descriptor={descriptor} />);
        expect(await screen.findByText('meal plan skeleton')).toBeTruthy();

        rerender(<RoadmapWidgetSlot descriptor={{ ...descriptor }} />);
        unmount();
        render(<RoadmapWidgetSlot descriptor={descriptor} />);

        expect(await screen.findByText('meal plan skeleton')).toBeTruthy();
        expect(load).toHaveBeenCalledTimes(1);
    });
});
