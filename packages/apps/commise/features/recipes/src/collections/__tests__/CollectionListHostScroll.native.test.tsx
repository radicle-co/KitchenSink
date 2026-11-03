/**
 * qa-android batch 5: on Collections the pinned search never slid or drew its band. The field sits where the page puts it and
 * the cards scroll under it, because the list's scroller was a plain one: the pin reads the host's `scrollY`, and only
 * `HostAnimatedScroll` (handed to FlashList through `renderScrollComponent`) feeds `scrollY` natively. With `scrollY` stuck at 0
 * the slide stays at its natural place and the band's opacity (`pinned * scrolled`) stays 0. Recipes supplied the scroller;
 * Collections did not. This pins that the Collections list supplies it, with the same function on every render.
 *
 * jsdom has no native driver, so it pins the wiring; that the field then slides and the band shows is for the device.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeCollection } from '@kitchensink/recipe-core/testing';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('@shopify/flash-list', () => ({
    FlashList: (props: Record<string, unknown>) => {
        rendered.props.push(props);

        return null;
    },
}));

import { HostAnimatedScroll } from '../../list/HostAnimatedScroll.native.js';
import { CollectionListResults } from '../CollectionListResults.native.js';

afterEach(() => {
    cleanup();
    rendered.props = [];
});

const noop = () => undefined;

function draw(): void {
    render(
        <LocaleProvider locale="en">
            <CollectionListResults
                collections={[makeCollection({ id: 'c1', name: 'One' })]}
                total={1}
                onSelect={noop}
                search={{ value: '', onChange: noop }}
                firstRun={{ hasRecipes: true, onAddRecipe: noop }}
            />
        </LocaleProvider>,
    );
}

describe('CollectionListResults (native) — the scroller feeds the host’s offset', () => {
    it('supplies HostAnimatedScroll through renderScrollComponent, the SAME function on every render', () => {
        draw();
        const first = rendered.props.at(-1)?.['renderScrollComponent'];
        cleanup();
        draw();

        expect(first).toBe(HostAnimatedScroll);
        expect(rendered.props.at(-1)?.['renderScrollComponent']).toBe(first);
    });
});
