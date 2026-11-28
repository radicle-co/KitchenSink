/**
 * PLANNED is not enforced: no (axis, event) pair of the enforced table appears in it, and nothing but the doc
 * generator imports it (the repoGuards check holds that).
 */
import { describe, expect, it } from 'vitest';

import { PLANNED } from '../recipeState/plannedTransitions.js';
import { TRANSITIONS } from '../recipeState/transitions.js';

const plannedAxisOf = (axis: string): string => (axis.startsWith('hold') ? 'holds' : axis);

describe('PLANNED', () => {
    it('shares no axis and event with an enforced edge', () => {
        const enforced = new Set(TRANSITIONS.map((row) => `${plannedAxisOf(row.axis)}:${row.event}`));
        const shared = PLANNED.map((row) => `${row.axis}:${row.eventId}`).filter((pair) => enforced.has(pair));

        expect(shared).toEqual([]);
    });

    it('names the work that builds each row, and gives each row a typed axis and event id', () => {
        for (const row of PLANNED) {
            expect(row.pending).not.toBe('');
            expect(row.eventId).toMatch(/^[A-Z][A-Z0-9_]+$/);
            expect(['holds', 'lifecycleAudience', 'origin', 'rewrittenFact', 'stepsCredit', 'bulk']).toContain(
                row.axis,
            );
        }
    });

    it('holds the clear of the correction hold until PR 5 builds it', () => {
        expect(PLANNED.find((row) => row.eventId === 'CLEAR_SOURCE_HOLD')?.pending).toBe('PR 5');
    });
});
