/**
 * The Null Object revealer (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): it shows nothing, but a `target`
 * request still hears that it was "shown" at once, because a field under a screen with no host (a `Modal`) would
 * otherwise never get the screen-reader cursor a refused Publish sends it.
 */
import { describe, expect, it, vi } from 'vitest';

import { revealNothing, withRevealEnd, type RevealRequest, type RevealTarget } from '../fieldRevealContext.js';

const field: RevealTarget = { measureLayout: () => undefined };

describe('revealNothing', () => {
    it('calls onShown at once for a target', () => {
        const onShown = vi.fn();

        revealNothing({ kind: 'target', field, onShown });

        expect(onShown).toHaveBeenCalledOnce();
    });

    it.each([
        ['list', { kind: 'list', field, below: 120 }],
        ['arrival', { kind: 'arrival', field, above: 60 }],
        ['focus', { kind: 'focus', field }],
    ] as const)('asks nothing for a %s, and hands back a release that does nothing', (_kind, request) => {
        const release = revealNothing(request);

        expect(release()).toBeUndefined();
    });

    it('hands back a release for a target that does nothing either', () => {
        const release = revealNothing({ kind: 'target', field, onShown: () => undefined });

        expect(release()).toBeUndefined();
    });
});

describe('withRevealEnd', () => {
    const end: RevealTarget = { measureLayout: () => undefined };

    it('adds the end to a focus request and hands back the parent’s release', () => {
        const release = (): void => undefined;
        const parent = vi.fn<(request: RevealRequest) => () => void>(() => release);

        const handed = withRevealEnd(parent, end)({ kind: 'focus', field });

        expect(parent).toHaveBeenCalledWith({ kind: 'focus', field, end });
        expect(handed).toBe(release);
    });

    it.each([
        ['list', { kind: 'list', field, below: 120 }],
        ['arrival', { kind: 'arrival', field, above: 60 }],
        ['start', { kind: 'start', field }],
    ] as const)('passes a %s request through unchanged', (_kind, request) => {
        const parent = vi.fn<(request: RevealRequest) => () => void>(() => () => undefined);

        withRevealEnd(parent, end)(request);

        expect(parent).toHaveBeenCalledWith(request);
    });

    it('passes a target request through unchanged', () => {
        const parent = vi.fn<(request: RevealRequest) => () => void>(() => () => undefined);
        const request: RevealRequest = { kind: 'target', field, onShown: () => undefined };

        withRevealEnd(parent, end)(request);

        expect(parent).toHaveBeenCalledWith(request);
    });
});
