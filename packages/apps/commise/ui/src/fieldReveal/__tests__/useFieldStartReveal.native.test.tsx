/**
 * An element a deep link names (`ScrollHost.scrollToStart`): when the count the scroll host keeps for its id goes UP, it
 * sends the reveal host a `start` request. It moves no focus and no screen-reader cursor (the row's own sheet or notice
 * owns those), and a count that stood when it mounted moves nothing.
 */
import { renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FieldTargetContext } from '../../scrollHost/fieldTarget.js';
import { FieldRevealContext, type FieldRevealer } from '../fieldRevealContext.js';
import { useFieldStartReveal } from '../useFieldStartReveal.native.js';

type StartNode = Parameters<typeof useFieldStartReveal>[1]['current'];

const makeNode = () => ({ measureLayout: vi.fn(), focus: vi.fn() });
const asNode = (node: ReturnType<typeof makeNode> | null): StartNode => node as unknown as StartNode;

function mount(initial: Readonly<Record<string, number>>, node: ReturnType<typeof makeNode> | null = makeNode()) {
    const release = vi.fn();
    const revealer = vi.fn<FieldRevealer>(() => release);
    const counts = { value: initial };
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <FieldRevealContext.Provider value={revealer}>
            <FieldTargetContext.Provider value={counts.value}>{children}</FieldTargetContext.Provider>
        </FieldRevealContext.Provider>
    );
    const hook = renderHook(() => useFieldStartReveal('row', { current: asNode(node) }), { wrapper });

    return {
        revealer,
        node,
        release,
        name: (value: Readonly<Record<string, number>>) => {
            counts.value = value;
            hook.rerender();
        },
    };
}

describe('useFieldStartReveal', () => {
    it('sends a start request for its element when its count goes up', () => {
        const { revealer, node, name } = mount({});

        expect(revealer).not.toHaveBeenCalled();

        name({ row: 1 });

        expect(revealer).toHaveBeenCalledExactlyOnceWith({ kind: 'start', field: node });
    });

    it('is inert under a count that stood when it mounted, and moves on the next rise', () => {
        const { revealer, name } = mount({ row: 2 });

        expect(revealer).not.toHaveBeenCalled();

        name({ row: 3 });

        expect(revealer).toHaveBeenCalledTimes(1);
    });

    it('ignores another id’s count, and a count that did not change', () => {
        const { revealer, name } = mount({});

        name({ other: 1 });
        expect(revealer).not.toHaveBeenCalled();

        name({ row: 1 });
        name({ row: 1 });
        expect(revealer).toHaveBeenCalledTimes(1);
    });

    it('asks nothing of a node that is not there, and never takes focus', () => {
        const none = mount({}, null);
        none.name({ row: 1 });
        expect(none.revealer).not.toHaveBeenCalled();

        const some = mount({});
        some.name({ row: 1 });
        expect(some.node?.focus).not.toHaveBeenCalled();
    });

    it('releases its request when the count rises again', () => {
        const { release, name } = mount({});

        name({ row: 1 });
        name({ row: 2 });

        expect(release).toHaveBeenCalledTimes(1);
    });
});
