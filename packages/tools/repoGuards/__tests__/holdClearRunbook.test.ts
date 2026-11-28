/**
 * ADR-0106: staff clear a correction hold from the runbook, so the runbook must name what a person at the keyboard needs: the
 * route, the id the preview returns, each refusal reason the route answers, and what the volume alarm means. A refusal reason
 * added to the contract without a runbook line leaves a person with a 409 and no next step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const RUNBOOK = readFileSync(path.join(repoRoot, 'docs/runbooks/sourceCorrection.md'), 'utf8');
/** The reasons are read from the contract's own source, so a reason added there needs a runbook line here (no package edge). */
const REASONS = [
    ...readFileSync(path.join(repoRoot, 'packages/shared/recipe-core/src/recipe.types.ts'), 'utf8').matchAll(
        /HOLD_CLEAR_CONFLICT_REASONS\s*=\s*\[([^\]]*)\]/g,
    ),
].flatMap((match) => [...match[1].matchAll(/'([A-Z_]+)'/g)].map((reason) => reason[1]));
/** The alarm threshold is read from its one declaration, so a changed number leaves the runbook red until it is updated. */
const THRESHOLD = /SOURCE_HOLD_CLEARED_DAILY_THRESHOLD\s*=\s*(\d+)/.exec(
    readFileSync(path.join(repoRoot, 'packages/shared/recipe-core/src/sourceEventNames.ts'), 'utf8'),
)?.[1];
const SECTION_START = '## Clear a hold';

/** The text of the `## Clear a hold` section, up to the next `## ` heading. Pure. */
function clearSection(text: string): string {
    const start = text.indexOf(SECTION_START);

    if (start === -1) {
        return '';
    }

    const rest = text.slice(start + SECTION_START.length);
    const next = rest.search(/\n## /);

    return next === -1 ? rest : rest.slice(0, next);
}

describe('the runbook section "Clear a hold"', () => {
    const section = clearSection(RUNBOOK);

    it('exists', () => {
        expect(section).not.toBe('');
    });

    it.each(['/source-correction/hold-clear', 'latestCorrectionId', 'source.holdCleared', 'recipes:source:correct'])(
        'names %s',
        (term) => {
            expect(section).toContain(term);
        },
    );

    it('reads the reasons from the contract', () => {
        expect(REASONS.length).toBeGreaterThan(0);
    });

    it.each(REASONS)('says what to do on the refusal reason %s', (reason) => {
        expect(section).toContain(reason);
    });

    it('states the alarm threshold the alarm uses', () => {
        expect(THRESHOLD).toBeDefined();
        expect(section).toContain(`more than ${THRESHOLD ?? ''} in one day`);
    });

    it('no longer says a hold never lifts', () => {
        expect(RUNBOOK).not.toMatch(/hold never lifts/i);
    });
});
