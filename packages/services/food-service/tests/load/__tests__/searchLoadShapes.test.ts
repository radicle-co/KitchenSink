/**
 * The k6 search scenario's SHAPES and the fixture's PROBE SET must name exactly the same things.
 *
 * ⛔ WHY THIS TEST EXISTS AT ALL. `search.load.js` reads its probes as `fixture.search.<shape>`, which is a
 * plain property read on parsed JSON: a shape naming a probe set that no longer exists gets `undefined`,
 * `new SharedArray(…)` over it throws inside k6's init stage, and the whole run dies before a single request
 * is sent. The mirror defect is silent and worse — a probe set nobody exercises is a query shape SC-007
 * claims to measure and does not. Neither is caught by the type system (JSON crosses the boundary untyped)
 * and neither is caught by CI, because the load tier is HEAVY (`heavy-e2e` label, nightly schedule, or manual
 * dispatch), so a dangling reference can sit on `main` for weeks and surface as a broken nightly.
 *
 * Plan U37 removed the `short` (two-character) shape, which is exactly the edit that produces one of those
 * two defects if it is made on one side only.
 *
 * ⚠️ It reads the k6 script as TEXT rather than importing it: `search.load.js` imports `k6/http` at module
 * scope, which exists only inside the k6 runtime. The regex is anchored on the ONE access form the file uses
 * and the file's own comment says so, so a rewrite that changes the form fails loudly here rather than
 * quietly matching nothing — which is why the count is asserted before the sets are compared.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildSearchProbes } from '../perfFixture.js';

/** The k6 scenario source, read as text — it cannot be imported outside the k6 runtime. */
const SEARCH_LOAD_SOURCE = readFileSync(fileURLToPath(new URL('../search.load.js', import.meta.url)), 'utf-8');

/** Every `fixture.search.<name>` the k6 scenario reads. */
function shapesReferencedByK6(): string[] {
    return [...SEARCH_LOAD_SOURCE.matchAll(/fixture\.search\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
}

describe('the k6 search scenario and the perf fixture agree on the probe set', () => {
    it('reads its probes through the one access form this guard understands', () => {
        // Asserted FIRST: if a rewrite changes how probes are reached, every comparison below would compare
        // two empty sets and pass while proving nothing.
        expect(shapesReferencedByK6().length).toBeGreaterThan(0);
    });

    it('references no shape the fixture does not produce (a dangling probe kills the k6 init stage)', () => {
        const produced = new Set(Object.keys(buildSearchProbes(1)));
        const dangling = shapesReferencedByK6().filter((shape) => !produced.has(shape));

        expect(dangling).toEqual([]);
    });

    it('exercises every shape the fixture produces (an unreferenced probe set is an unmeasured shape)', () => {
        const referenced = new Set(shapesReferencedByK6());
        const unexercised = Object.keys(buildSearchProbes(1)).filter((shape) => !referenced.has(shape));

        expect(unexercised).toEqual([]);
    });

    it('no longer carries the two-character `short` shape (003-FR-010a, plan U37)', () => {
        // ⚠️ A change-detector on purpose, and narrowly scoped to ONE name. The bidirectional guards above
        // stay green if `short` is removed from BOTH sides or kept on both; only this case records that
        // FR-010a made a two-character query unanswerable, so measuring its latency would report the speed
        // of a request that never touches the database as evidence that search is fast.
        expect(Object.keys(buildSearchProbes(1))).not.toContain('short');
        expect(SEARCH_LOAD_SOURCE).not.toContain('probes-short');
    });
});
