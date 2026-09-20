/**
 * OfflineReadSlot (web) — asserted against the CONTRACT in `props.ts`, not against the implementation.
 *
 * ⚠️ HONEST PROVENANCE: the leaf existed before this file, so this is not a red-first test and must not be
 * read as one. What stands in for the red step is that every assertion below was proved to FAIL against a
 * mutated leaf — the contract clause, then the mutation that breaks it, is named on each one. A test written
 * after the code is worth only what a mutation proves.
 *
 * The contract, from `props.ts`:
 *   1. It renders the caller's localized message; the design system holds no copy.
 *   2. It offers NO control — a parked read resumes by itself, so a Retry would claim the viewer must act.
 *   3. Web keeps a polite `status` region; the native twin deliberately has none.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OfflineReadSlot } from '../OfflineReadSlot.js';

const MESSAGE = 'Waiting for a connection. This loads on its own.';

describe('OfflineReadSlot (web)', () => {
    /** Contract 1. Mutation: hard-code a literal instead of rendering `message` ⇒ reds. */
    it('renders the caller-supplied message rather than copy of its own', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.getByText(MESSAGE)).toBeTruthy();
    });

    /**
     * Contract 3. Mutation: drop `role="status"` ⇒ reds.
     *
     * ⚠️ The announcement is UNRELIABLE here — a Suspense fallback mounts with its text already present,
     * which is not guaranteed to be read out. It is kept because unreliable is not absent: the region costs
     * nothing, never interrupts, and is this surface's only channel.
     */
    it('⛔ exposes the message through a polite status region', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.getByRole('status').textContent).toBe(MESSAGE);
    });

    /**
     * Contract 2, and the one most likely to be "helpfully" broken by a future reader who thinks a stuck
     * screen needs a Retry. Mutation: add any button ⇒ reds.
     */
    it('⛔ offers NO control — the read recovers without the viewer acting', () => {
        render(<OfflineReadSlot message={MESSAGE} />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
