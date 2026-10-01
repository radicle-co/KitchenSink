/**
 * Component tests for the mobile roadmap placeholder slot, rendered via react-native-web under jsdom: it draws
 * whatever skeleton its descriptor's loader resolves, and it resolves that skeleton ONCE per loader.
 *
 * ⛔ The second case is the one that matters — see the web twin (`RoadmapWidgetSlot.test.tsx`). A `lazy()` built in
 * `useMemo` during render is a component type created during render (`react-hooks/static-components`), and it
 * re-imported the chunk on every remount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { HomeWidgetDescriptor } from '@commise/features-core';
import { Text } from 'react-native';

import { RoadmapWidgetSlot } from '../../../src/components/home/RoadmapWidgetSlot.js';

afterEach(cleanup);

function Skeleton() {
    return <Text>meal plan skeleton</Text>;
}

const descriptorFor = (load: HomeWidgetDescriptor['load']): HomeWidgetDescriptor =>
    ({
        id: 'meal-plan',
        kind: 'placeholder',
        capability: 'meal-plans',
        defaultWeight: 1,
        load,
    }) as HomeWidgetDescriptor;

describe('RoadmapWidgetSlot (mobile)', () => {
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
