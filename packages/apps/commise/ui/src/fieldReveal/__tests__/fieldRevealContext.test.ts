/**
 * The Null Object revealer (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): it shows nothing, but a `target`
 * request still hears that it was "shown" at once, because a field under a screen with no host (a `Modal`) would
 * otherwise never get the screen-reader cursor a refused Publish sends it.
 */
import { describe, expect, it, vi } from 'vitest';

import { revealNothing, type RevealTarget } from '../fieldRevealContext.js';

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
