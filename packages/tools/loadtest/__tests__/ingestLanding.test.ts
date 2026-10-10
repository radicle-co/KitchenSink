/**
 * THE ANALYTICS INGEST SCENARIO MUST FAIL WHEN IT LANDS NOTHING.
 *
 * ⛔ The defect (staff-architect REVIEW, LOW-7): `analyticsIngest.load.js` checked only for `202`. The door answers
 * `202 { accepted, landed: 0 }` both when a batch is SHED under load — a success by contract — and when every event
 * is refused for another reason (a contained test principal on an enforcing stage, ADR-0040), so a run that stored
 * not one event read exactly like a healthy one. The same pathology as the null-fixture cache `pullFromSource` had.
 *
 * So the scenario counts what LANDED and thresholds the run on `count>0`. A shed batch still passes the per-request
 * check; a run where no batch landed at all fails. These tests pin the reader the counter is fed from: it must read
 * the number the service reports, and it must never invent a landing out of a body that does not report one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { landedEvents } from '../k6/ingestLanding.js';

describe('landedEvents', () => {
    it('reads the landed count a 202 body reports', () => {
        expect(landedEvents('{"accepted":3,"landed":2}')).toBe(2);
    });

    it('reads a shed (or contained) batch as zero landed — a real answer, not an absence', () => {
        expect(landedEvents('{"accepted":3,"landed":0}')).toBe(0);
    });

    it.each([
        ['an empty body', ''],
        ['a body that is not JSON', 'Service Unavailable'],
        ['a JSON body with no landed count', '{"accepted":3}'],
        ['a landed count that is not a number', '{"accepted":3,"landed":"2"}'],
        ['a negative landed count', '{"accepted":3,"landed":-1}'],
        ['a fractional landed count', '{"accepted":3,"landed":1.5}'],
        ['JSON null', 'null'],
    ])('reports no landing report for %s, so nothing is counted as landed', (_, body) => {
        expect(landedEvents(body)).toBeNull();
    });
});

describe('the analytics ingest scenario is GATED on landing, not merely instrumented', () => {
    const SCENARIO = fileURLToPath(
        new URL('../../../services/recipe-service/tests/load/analyticsIngest.load.js', import.meta.url),
    );
    const source = readFileSync(SCENARIO, 'utf8');
    const counter = /const (\w+) = new Counter\('([\w]+)'\)/u.exec(source);

    it('feeds a Counter from landedEvents on every response', () => {
        expect(source).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/tools\/loadtest\/k6\/ingestLanding\.js'/u);
        expect(counter, 'no landed-events Counter is declared').not.toBeNull();
        // ⛔ Added for EVERY response, zero included: a Counter that never receives a sample has no threshold
        // verdict at all, which is a green run over nothing — the defect this closes.
        expect(source).toMatch(new RegExp(`${counter?.[1] ?? '(none)'}\\.add\\(landed \\?\\? 0\\)`, 'u'));
    });

    it('⛔ thresholds that Counter on count>0 in every profile — a check() alone moves no exit code', () => {
        const thresholds = source.slice(
            source.indexOf('thresholds: {'),
            source.indexOf('},', source.indexOf('thresholds: {')),
        );

        expect(thresholds).toContain(`${counter?.[2] ?? '(none)'}: ['count>0']`);
        expect(thresholds).not.toMatch(new RegExp(`whenSubstrate\\(\\{\\s*${counter?.[2] ?? '(none)'}`, 'u'));
    });
});
