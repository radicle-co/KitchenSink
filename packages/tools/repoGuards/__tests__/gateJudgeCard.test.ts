// @vitest-environment node
/**
 * Repo-wide guard: **the agent card the CI judge runs as tells it that, in GATE, the structured output call is the report.**
 *
 * The GATE judge runs as `--agent staff-code-quality` with read-only tools and no shell. Before this guard the card gave it
 * instructions it could not meet or that competed with the structured call: a refusal that needs `$GITHUB_ACTIONS`, a
 * playbook skill it cannot load, a fixed prose report spine, and a request to run tests. Each regression the QSE and
 * the red team named is pinned below (decisions/gateJudgeRetry-staff.md RC-1 step 2, decisions/gateJudgeCard-qse.md,
 * reviews/gateJudgeRetry-redteam.md), and each test was seen red on the regression it names.
 *
 * These are text guards: they prove the instruction is on the card, not that the model obeys it. The proof is the first
 * PRs judged after this one merges.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fold = (text: string): string => text.replace(/\s+/gu, ' ');
const rawCard = readFileSync(path.join(repoRoot, '.claude/agents/staff-code-quality.md'), 'utf8');
const rawPlaybook = readFileSync(path.join(repoRoot, '.claude/skills/code-quality-mode-playbooks/SKILL.md'), 'utf8');

/** The card and the playbook with line wraps folded to one space, so a sentence is matched however it wraps. */
const card = fold(rawCard);
const playbook = fold(rawPlaybook);

const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + from.length);

    expect(start, `${from} is missing`).toBeGreaterThanOrEqual(0);
    expect(end, `${to} is missing after ${from}`).toBeGreaterThan(start);

    return text.slice(start, end);
};

/** The §7 GATE bullet: from its bold label to the next mode's bold label. */
const gateBullet = (): string => between(card, '- **GATE** —', '- **REVIEW** —');

/** The playbook's GATE section: from its heading to the REVIEW heading. */
const playbookGate = (): string => between(playbook, '## GATE —', '## REVIEW —');

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

describe('the staff-code-quality card, GATE mode', () => {
    it('says the structured output call is the report, as the last action, with no prose after it', () => {
        const bullet = gateBullet();

        expect(bullet).toContain('the structured output call IS the report');
        expect(bullet).toContain('LAST action');
        expect(bullet).toContain('nothing after it');
        expect(bullet).toContain('write no closing prose');
        // The spine is named once, and only to forbid it: a line asking for it "as a summary" would be a second report.
        expect(countOf(bullet, '§9 spine')).toBe(1);
        expect(bullet).toContain('Do not write the §9 spine');
    });

    it('triggers on the tool the judge can observe, never on an environment variable it cannot read', () => {
        expect(card).not.toContain('refuses to run unless');
        expect(gateBullet()).not.toContain('$GITHUB_ACTIONS');
        expect(gateBullet()).toContain('GATE runs only when you have the structured output tool');
        expect(playbookGate()).not.toContain('$GITHUB_ACTIONS');
        expect(playbookGate()).toContain('GATE runs only when you have the structured output tool');
    });

    it('has exactly one playbook-load instruction, scoped to REVIEW and INSPECT, and GATE reads the GATE section only', () => {
        expect(countOf(card, 'load the `code-quality-mode-playbooks` skill')).toBe(1);
        expect(card).toContain('In REVIEW and INSPECT, then load the `code-quality-mode-playbooks` skill');
        expect(gateBullet()).not.toContain('load the');
        expect(gateBullet()).toContain(
            'Read only the GATE section of `.claude/skills/code-quality-mode-playbooks/SKILL.md`',
        );
        expect(gateBullet()).toContain('ignore its Body and Length');
    });

    it('keeps the playbook GATE rules that fail closed', () => {
        const gate = playbookGate();

        expect(gate).toContain('does not name this commit, is a blocker');
        expect(gate).toContain('reaches L3+, the finding is STRUCTURAL and the verdict is BLOCK');
        expect(gate).toContain('(always do that search)');
        expect(gate).toContain('Never run a scanner');
    });

    it('maps the verdict to PASS and BLOCK, majors to blocking, and counts only a deferral already on the base branch', () => {
        const bullet = gateBullet();

        expect(bullet).toContain('`verdict`: `BLOCK`');
        expect(bullet).toContain('There is no "PASS WITH FINDINGS" in GATE');
        expect(bullet).toContain('`blocking` for critical and for major');
        expect(bullet).toContain('A deferral counts only if it already exists on the base branch');
    });

    it('has no GATE prose spine: the spine heading lists REVIEW and INSPECT only', () => {
        const heading = rawCard.split('\n').find((line) => line.startsWith('## Code quality: [scope]'));

        expect(heading, 'the spine heading is missing').toBeDefined();
        expect(heading).toContain('[REVIEW | INSPECT]');
        expect(heading).not.toContain('GATE |');
        expect(card).toContain('GATE has no spine');
    });

    it('tells GATE to run nothing: no tests in Pass 1, and the description is CI-only', () => {
        const pass1 = between(card, '### Pass 1', '### Pass 2');
        const description = rawCard.split('\n').find((line) => line.startsWith('description:')) ?? '';

        expect(pass1).toContain('In GATE, run nothing');
        expect(pass1).not.toContain('unit tests in GATE');
        expect(description).not.toContain('(GATE the working diff)');
        expect(description).toContain('GATE runs only in CI');
    });
});
