// @vitest-environment node
/**
 * Repo-wide guard: **the files the GATE judge is restored from the base branch for are one set, written twice.**
 *
 * `gate.yml` ("Install the judge from the base branch") restores them with a shell `pattern`, and `gateScope.mjs`
 * (`RESTORED_FROM_BASE`) tells the judge, in its brief, which judged files it sees at the base version. The two copies
 * cannot be one: the shell step runs before the GATE tooling is installed, so it cannot import the policy. This guard
 * keeps them equal. It proves the shell pattern holds every alternative of the policy and that it restores the
 * standards a PR could otherwise loosen to pass itself. It does not prove the judge obeys the brief.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const gateYml = readFileSync(path.join(repoRoot, '.github/workflows/gate.yml'), 'utf8');

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The alternatives `gateScope.mjs` exports for the restored set, read through the real module. */
const policyAlternatives = async (): Promise<string[]> => {
    const policy: unknown = await import(pathToFileURL(path.join(repoRoot, 'tooling/codeQuality/gateScope.mjs')).href);
    const alternatives =
        typeof policy === 'object' && policy !== null && 'RESTORED_FROM_BASE_ALTERNATIVES' in policy
            ? policy.RESTORED_FROM_BASE_ALTERNATIVES
            : undefined;

    if (!isStringArray(alternatives)) {
        throw new Error('gateScope.mjs does not export RESTORED_FROM_BASE_ALTERNATIVES as a list of strings');
    }

    return alternatives;
};

/** The shell `pattern` of the judge-source step, exactly as written between its single quotes. */
const shellPattern = (): string => {
    const match = /^\s*pattern='([^']+)'\s*$/mu.exec(gateYml);

    if (match === null) {
        throw new Error("gate.yml has no `pattern='...'` line in the judge-source step");
    }

    return match[1] ?? '';
};

describe('GATE judge files restored from the base branch', () => {
    it('1. the shell pattern restores the standards, an ADR and an engineering doc as well as the instruction files', () => {
        const pattern = new RegExp(shellPattern(), 'u');

        for (const restored of [
            'CLAUDE.md',
            'packages/x/CLAUDE.md',
            'CLAUDE.local.md',
            'AGENTS.md',
            '.mcp.json',
            '.claude/agents/staff-code-quality.md',
            '.claude',
            'pkg/.claude',
            'docs/CODING_STANDARDS.md',
            'docs/architecture/decisions/0098-gate-runs-in-ci.md',
            'docs/engineering/ENGINEERING_EXCELLENCE.md',
            'docs/adr/0001-x.md',
            'adr/0001-x.md',
            'docs/architecture',
            'docs/engineering',
        ]) {
            expect(pattern.test(restored), restored).toBe(true);
        }

        for (const kept of ['docs/CODING_STANDARDS.md.bak', 'docs/design/a.md', 'specs/f/tasks.md', 'adr-notes/x.md']) {
            expect(pattern.test(kept), kept).toBe(false);
        }
    });

    it('2. the shell pattern contains every alternative of the policy set, so the two copies cannot drift', async () => {
        const pattern = shellPattern();
        const alternatives = await policyAlternatives();

        expect(alternatives.length).toBeGreaterThanOrEqual(4);

        for (const alternative of alternatives) {
            expect(pattern, alternative).toContain(alternative);
        }
    });

    it('3. the shell pattern holds nothing the policy set lacks', async () => {
        const alternatives = await policyAlternatives();

        expect(shellPattern()).toBe(alternatives.join('|'));
    });
});
