/**
 * Combobox (native) — the distance an arrival asks for (`docs/design/uiOverhaul/ingredientArrival.md`), as laid out.
 *
 * The host measures the FIELD, and the arrived row sits above the whole combobox, so the leaf adds where its field row
 * sits inside it: the label, its hint and the gap under them. ⛔ That span is READ from the field row's own layout, never
 * rebuilt from the label's height and a copy of the root's gap — a copy is a second authority, and it goes wrong the day
 * the root's gap changes. So the case lays the label out at a height whose sum with the house gap is NOT where the field
 * row is, and asks for the row's own `y`.
 *
 * react-native-web reports layout through one `ResizeObserver` and each node's `offsetTop`/`offsetHeight`, none of which
 * jsdom has, so the test records the observer and reports a layout through it (`BottomChromeFrame.native.test.tsx`'s
 * method). The observer stub is installed before any import, because react-native-web creates its one observer lazily.
 */
import { resizeObserver as observer } from '../../testing/resizeObserver.js';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldRevealContext, type FieldRevealer } from '../../fieldReveal/fieldRevealContext.js';
import { Combobox } from '../Combobox.native.js';
import type { ComboboxProps } from '../props.js';

afterEach(() => {
    cleanup();
    observer.observed.clear();
});

const Host: FC<Pick<ComboboxProps, 'arrival'>> = (props) => (
    <Combobox
        id="add-ingredient"
        label="Add an ingredient"
        hint="Type to search foods, then choose one."
        listLabel="Food suggestions"
        value=""
        onValueChange={vi.fn()}
        groups={[]}
        onSelect={vi.fn()}
        countAnnouncement=""
        {...props}
    />
);

/** Every watched node, laid out: `place` gives a node its top and height, or leaves it at 0 by answering undefined. */
async function layOut(place: (node: Element) => { readonly top: number; readonly height: number } | undefined) {
    const nodes = [...observer.observed];

    for (const node of nodes) {
        const at = place(node) ?? { top: 0, height: 0 };

        Object.defineProperty(node, 'offsetTop', { value: at.top, configurable: true });
        Object.defineProperty(node, 'offsetHeight', { value: at.height, configurable: true });
    }

    await act(async () => {
        observer.callback?.(
            nodes.map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
        // react-native-web measures on the next task.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

const field = (): HTMLInputElement => screen.getByLabelText('Add an ingredient');

describe('Combobox (native) — an arrival, as laid out', () => {
    it('adds where the field row sits in the combobox, as laid out, to the row above it', async () => {
        const revealer = vi.fn<FieldRevealer>(() => vi.fn());
        const tree = (arrival?: ComboboxProps['arrival']) => (
            <FieldRevealContext.Provider value={revealer}>
                <Host {...(arrival === undefined ? {} : { arrival })} />
            </FieldRevealContext.Provider>
        );
        const rendered = render(tree());

        // The label block is 20 dp tall, and the field row starts 30 dp down: the house gap is not 10 dp, so a distance
        // rebuilt from the label's height and a gap cannot land on 30.
        await layOut((node) => {
            if (node.contains(field())) {
                return { top: 30, height: 48 };
            }

            return node.textContent?.includes('Add an ingredient') === true ? { top: 0, height: 20 } : undefined;
        });

        rendered.rerender(tree({ key: 'line-1', aboveDp: 60 }));

        expect(revealer).toHaveBeenCalledExactlyOnceWith({ field: field(), below: 0, kind: 'arrival', above: 90 });
    });
});
