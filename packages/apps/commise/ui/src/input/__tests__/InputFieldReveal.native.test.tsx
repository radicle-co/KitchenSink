/**
 * `Input` and `TextArea` (native) and the field reveal (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): a focused
 * field asks the reveal host to hold it in view and lets go on blur; a field the screen names is shown, and the
 * screen-reader cursor moves to it once it is. Neither takes keyboard focus for the second.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cursor = vi.hoisted(() => ({ moved: [] as unknown[] }));

vi.mock('../../screenReaderFocus/moveScreenReaderFocus.native.js', () => ({
    moveScreenReaderFocus: (node: unknown): void => {
        cursor.moved.push(node);
    },
}));

import { FieldRevealContext, type FieldRevealer, type RevealRequest } from '../../fieldReveal/fieldRevealContext.js';
import { FieldTargetContext } from '../../scrollHost/fieldTarget.js';
import { Input } from '../Input.native.js';
import { TextArea } from '../TextArea.native.js';

afterEach(() => {
    cleanup();
    cursor.moved = [];
});

const LEAVES: readonly [string, FC<{ readonly id: string }>][] = [
    ['Input', ({ id }) => <Input id={id} label="Title" value="" onChangeText={vi.fn()} />],
    ['TextArea', ({ id }) => <TextArea id={id} label="Title" value="" onChangeText={vi.fn()} minRows={2} />],
];

describe.each(LEAVES)('%s (native) — the field reveal', (_name, Leaf) => {
    /** Render the leaf under a spy host, with the counts a case can change. */
    function hosted(initial: Readonly<Record<string, number>> = {}) {
        const release = vi.fn();
        const revealer = vi.fn<FieldRevealer>(() => release);
        const tree = (counts: Readonly<Record<string, number>>) => (
            <FieldRevealContext.Provider value={revealer}>
                <FieldTargetContext.Provider value={counts}>
                    <Leaf id="title" />
                </FieldTargetContext.Provider>
            </FieldRevealContext.Provider>
        );
        const rendered = render(tree(initial));
        const requests = (kind: RevealRequest['kind']): RevealRequest[] =>
            revealer.mock.calls.flatMap(([request]) => (request.kind === kind ? [request] : []));

        return {
            release,
            requests,
            name: (counts: Readonly<Record<string, number>>) => rendered.rerender(tree(counts)),
        };
    }

    const field = (): HTMLElement => screen.getByRole('textbox');

    it('sends nothing before the field is focused', () => {
        const { requests } = hosted();

        expect(requests('focus')).toEqual([]);
    });

    it('sends a focus request carrying its own node when it gains focus', () => {
        const { requests } = hosted();

        act(() => {
            fireEvent.focus(field());
        });

        const [request] = requests('focus');
        expect(requests('focus')).toHaveLength(1);
        expect(request?.field).toBe(field());
    });

    it('releases the request when it blurs', () => {
        const { release } = hosted();
        act(() => {
            fireEvent.focus(field());
        });

        act(() => {
            fireEvent.blur(field());
        });

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a count that stood when it mounted', () => {
        const { requests } = hosted({ title: 2 });

        expect(requests('target')).toEqual([]);
    });

    it('is shown when its count goes up, and only then moves the screen-reader cursor to itself', () => {
        const { name, requests } = hosted({ title: 0 });

        name({ title: 1 });

        const [target] = requests('target');
        expect(target?.kind).toBe('target');
        expect(target?.field).toBe(field());
        expect(cursor.moved).toEqual([]);

        if (target?.kind === 'target') {
            target.onShown();
        }

        expect(cursor.moved).toEqual([field()]);
    });

    it('takes no keyboard focus when it is named', () => {
        const { name } = hosted({ title: 0 });

        name({ title: 1 });

        expect(document.activeElement).not.toBe(field());
    });

    it('ignores another field’s count', () => {
        const { name, requests } = hosted({ title: 0, servings: 0 });

        name({ title: 0, servings: 1 });

        expect(requests('target')).toEqual([]);
    });
});
