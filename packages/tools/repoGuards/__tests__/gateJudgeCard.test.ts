// @vitest-environment node
/**
 * Repo-wide guard: **the agent card the CI judge runs as tells it that, in GATE, the structured output call is the report.**
 *
 * The GATE judge runs as `--agent staff-code-quality` with read-only tools and no shell. Before this guard the card gave it
 * instructions it could not meet or that competed with the structured call: a refusal that needs `$GITHUB_ACTIONS`, a
 * playbook skill it cannot load, and a fixed prose report spine. The judge then ended in prose, the action found no
 * `structured_output`, and the GATE failed (decisions/gateJudgeRetry-staff.md, RC-1 step 2).
 *
 * These are text guards: they prove the instruction is on the card, not that the model obeys it. The proof is the first
 * PRs judged after this one merges.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const card = readFileSync(path.join(repoRoot, '.claude/agents/staff-code-quality.md'), 'utf8');

/** The card text with line wraps folded to one space, so a sentence is matched however the card wraps it. */
const flat = card.replace(/\s+/gu, ' ');

/** The §7 GATE bullet: from its bold label to the next mode's bold label. */
const gateBullet = (): string => {
    const start = flat.indexOf('- **GATE** —');
    const end = flat.indexOf('- **REVIEW** —', start);

    expect(start, 'the §7 GATE bullet is missing').toBeGreaterThanOrEqual(0);
    expect(end, 'the §7 REVIEW bullet is missing').toBeGreaterThan(start);

    return flat.slice(start, end);
};

describe('the staff-code-quality card, GATE mode', () => {
    it('says the structured output call is the report, as the last action', () => {
        const bullet = gateBullet();

        expect(bullet).toContain('the structured output call IS the report');
        expect(bullet).toContain('LAST action');
    });

    it('does not ask the judge to prove it runs in CI (it has no shell to read the environment)', () => {
        expect(card).not.toContain('refuses to run unless');
    });

    it('scopes the mode playbook to REVIEW and INSPECT (GATE cannot load a user-scoped skill)', () => {
        expect(flat).toContain('In REVIEW and INSPECT, then load the `code-quality-mode-playbooks` skill');
        expect(gateBullet()).toContain('Do not load the mode playbook');
    });

    it('has no GATE prose spine: the spine heading lists REVIEW and INSPECT only', () => {
        const heading = card.split('\n').find((line) => line.startsWith('## Code quality: [scope]'));

        expect(heading, 'the spine heading is missing').toBeDefined();
        expect(heading).toContain('[REVIEW | INSPECT]');
        expect(heading).not.toContain('GATE |');
        expect(flat).toContain('GATE has no spine');
    });

    it('maps the GATE verdict to PASS and BLOCK only', () => {
        const bullet = gateBullet();

        expect(bullet).toContain('`verdict`: `BLOCK`');
        expect(bullet).toContain('There is no "PASS WITH FINDINGS" in GATE');
    });
});
