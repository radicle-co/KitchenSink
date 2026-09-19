/**
 * OfflineReadSlot (native) — asserted against the CONTRACT in `props.ts`, not against the implementation.
 *
 * ⚠️ HONEST PROVENANCE: as with the web twin, the leaf predates this file, so the mutation proof below is
 * what stands in for a red-first run.
 *
 * ⛔ THE DIVERGENCE FROM WEB IS DELIBERATE AND IS ASSERTED SO IT CANNOT BE "FIXED". React Native's only live
 * region (`accessibilityLiveRegion="assertive"`) INTERRUPTS the screen reader — wrong for a state the viewer
 * neither triggered nor needs to act on — and the polite variant is Android-only. Parity with web's quiet
 * `status` is therefore reached by announcing nothing rather than by announcing rudely.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OfflineReadSlot } from '../OfflineReadSlot.native.js';

const MESSAGE = 'Waiting for a connection. This loads on its own.';

describe('OfflineReadSlot (native)', () => {
    /** Contract 1. Mutation: hard-code a literal ⇒ reds. */
    it('renders the caller-supplied message rather than copy of its own', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.getByText(MESSAGE)).toBeTruthy();
    });

    /** The deliberate divergence. Mutation: add a live region ⇒ reds. */
    it('⛔ announces nothing — no live region, by design', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    /** Contract 2. Mutation: add any pressable ⇒ reds. */
    it('⛔ offers NO control — the read recovers without the viewer acting', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
