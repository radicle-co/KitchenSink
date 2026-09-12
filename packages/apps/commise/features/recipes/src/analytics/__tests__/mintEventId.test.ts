/**
 * Analytics U5 (staff-architect REVIEW F1) — the event-id minter's WEB leaf.
 *
 * The minter is a PLATFORM SEAM because Hermes ships no `crypto` global — the structural half of that
 * rule (the shared hook reaches ids only through the seam; the native leaf delegates to `expo-crypto`
 * and never the bare global) is guarded where source-reading guards live:
 * `packages/infra/global/__tests__/analyticsMintEventIdSeam.test.ts`. This browser-typed package
 * (`types: []`) pins only the leaf's behavior.
 */
import { describe, expect, it } from 'vitest';

import { mintEventId } from '../mintEventId.js';

describe('mintEventId (web leaf)', () => {
    it('mints RFC-4122-shaped ids, distinct per call', () => {
        const first = mintEventId();
        const second = mintEventId();

        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(second).not.toBe(first);
    });
});
