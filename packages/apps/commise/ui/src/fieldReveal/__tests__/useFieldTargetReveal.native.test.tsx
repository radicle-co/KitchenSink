/**
 * A field a refused Publish names (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): when the count the scroll host
 * keeps for its id goes UP, it sends the reveal host a `target` request, and once it is shown it moves the
 * screen-reader cursor to itself. It never takes keyboard focus, and a count that stood when it mounted moves nothing.
 */
import { renderHook } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cursor = vi.hoisted(() => ({ moved: [] as unknown[] }));

vi.mock('../../screenReaderFocus/moveScreenReaderFocus.native.js', () => ({
    moveScreenReaderFocus: (node: unknown): void => {
        cursor.moved.push(node);
    },
}));

import { FieldTargetContext } from '../../scrollHost/fieldTarget.js';
import { FieldRevealContext, type FieldRevealer, type RevealRequest } from '../fieldRevealContext.js';
import { useFieldTargetReveal } from '../useFieldTargetReveal.native.js';

/** What a field's ref holds, which a fake node stands in for: react-native-web has no native element. */
type FieldNode = Parameters<typeof useFieldTargetReveal>[1]['current'];

beforeEach(() => {
    cursor.moved = [];
});

/** The node a field holds: measurable, announceable, and a `focus` that must never be called. */
const makeNode = () => ({ measureLayout: vi.fn(), focus: vi.fn() });

/** The fake, typed as the field's node. */
const asNode = (node: ReturnType<typeof makeNode> | null): FieldNode => node as unknown as FieldNode;

/**
 * Mount `useFieldTargetReveal('title', …)` under a host whose revealer is a spy, with counts the case can change and
 * re-render with.
 */
function mount(initial: Readonly<Record<string, number>>, node: ReturnType<typeof makeNode> | null = makeNode()) {
    const release = vi.fn();
    const revealer = vi.fn<FieldRevealer>(() => release);
    const counts = { value: initial };
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <FieldRevealContext.Provider value={revealer}>
            <FieldTargetContext.Provider value={counts.value}>{children}</FieldTargetContext.Provider>
        </FieldRevealContext.Provider>
    );
    const hook = renderHook(() => useFieldTargetReveal('title', { current: asNode(node) }), { wrapper });

    return {
        node,
        release,
        revealer,
        unmount: hook.unmount,
        name: (next: Readonly<Record<string, number>>): void => {
            counts.value = next;
            hook.rerender();
        },
        targets: (): Extract<RevealRequest, { kind: 'target' }>[] =>
            revealer.mock.calls.flatMap(([request]) => (request.kind === 'target' ? [request] : [])),
    };
}

describe('useFieldTargetReveal', () => {
    it('does nothing for a count that stood when the field mounted', () => {
        const { revealer } = mount({ title: 3 });

        expect(revealer).not.toHaveBeenCalled();
    });

    it('does nothing outside any scroll host', () => {
        const revealer = vi.fn<FieldRevealer>(() => () => undefined);

        renderHook(() => useFieldTargetReveal('title', { current: asNode(makeNode()) }), {
            wrapper: ({ children }) => (
                <FieldRevealContext.Provider value={revealer}>{children}</FieldRevealContext.Provider>
            ),
        });

        expect(revealer).not.toHaveBeenCalled();
    });

    it('sends a target request when its count goes up, and moves the cursor to itself once shown', () => {
        const { node, name, targets } = mount({ title: 0 });

        name({ title: 1 });

        const [target] = targets();
        expect(target?.field).toBe(node);
        expect(cursor.moved).toEqual([]);

        target?.onShown();

        expect(cursor.moved).toEqual([node]);
        expect(node?.focus).not.toHaveBeenCalled();
    });

    it('sends another target for each further increase, and none for another field’s', () => {
        const { name, targets } = mount({ title: 0, servings: 0 });

        name({ title: 1, servings: 0 });
        name({ title: 1, servings: 1 });
        expect(targets()).toHaveLength(1);

        name({ title: 2, servings: 1 });

        expect(targets()).toHaveLength(2);
    });

    it('releases its request when it unmounts', () => {
        const { name, release, unmount } = mount({ title: 0 });
        name({ title: 1 });

        unmount();

        expect(release).toHaveBeenCalled();
    });

    it('asks nothing of a field with no node to measure', () => {
        const { name, revealer } = mount({ title: 0 }, null);

        name({ title: 1 });

        expect(revealer).not.toHaveBeenCalled();
    });
});
