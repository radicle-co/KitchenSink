/**
 * The web cooking foot as the snackbar host sees it: the room under the foot's top edge is kept clear, and the host is
 * told when the foot changes size. Run over a registry that records the entry, and a foot whose rectangle the test sets.
 * Mutation lens: an inset read from the foot's height instead of its top edge, a missing foot that still reserves room,
 * and a watch that never subscribes each fail a row here.
 */
import { PopupInsetsRegistryContext, type PopupInsetsEntry } from '@commise/ui/popup-insets';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COOKING_FOOT_ID, CookingFootInsets, footInsetsOf } from '../CookingFootInsets.js';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('footInsetsOf', () => {
    it('keeps clear from the foot’s top edge to the bottom of the viewport', () => {
        expect(footInsetsOf({ footTop: 640, viewportHeight: 800 })).toEqual({ top: 0, bottom: 160 });
    });

    it('keeps nothing clear when there is no foot, or it is below the viewport', () => {
        expect(footInsetsOf({ footTop: undefined, viewportHeight: 800 })).toEqual({ top: 0, bottom: 0 });
        expect(footInsetsOf({ footTop: 900, viewportHeight: 800 })).toEqual({ top: 0, bottom: 0 });
    });
});

describe('CookingFootInsets', () => {
    function setup(): PopupInsetsEntry[] {
        const live: PopupInsetsEntry[] = [];
        const registry = {
            register: (entry: PopupInsetsEntry) => {
                live.push(entry);

                return () => undefined;
            },
        };

        render(
            <PopupInsetsRegistryContext value={registry}>
                <CookingFootInsets>
                    <div id={COOKING_FOOT_ID} />
                </CookingFootInsets>
            </PopupInsetsRegistryContext>,
        );

        return live;
    }

    it('registers a reader of the foot’s top edge', () => {
        const live = setup();
        const foot = document.getElementById(COOKING_FOOT_ID);

        vi.spyOn(foot ?? document.body, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 700 }));

        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);

        expect(live).toHaveLength(1);
        expect(live[0]?.read().bottom).toBe(100);
    });

    it('registers a watch on the foot, which tells the host when it changes size', () => {
        const observe = vi.fn();
        const disconnect = vi.fn();

        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe = observe;
                disconnect = disconnect;
            },
        );
        const live = setup();
        const stop = live[0]?.watch?.(() => undefined);

        expect(observe).toHaveBeenCalledWith(document.getElementById(COOKING_FOOT_ID), { box: 'border-box' });

        stop?.();

        expect(disconnect).toHaveBeenCalled();
    });
});
