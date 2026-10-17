// @vitest-environment node
/**
 * Repo-wide guard: **Sandbox Up must refuse to start while the shared tier is being released** (ADR-0060).
 *
 * ## The failure this pins
 *
 * Sandbox Down's `release-if-idle` asked "is anything starting a preview?" ONCE, then deleted the identity service,
 * its schema stack and the ALB for several minutes. A Sandbox Up pressed inside that window found the ALB still
 * standing, deployed onto it, and had it deleted underneath. The release now re-asks before every delete
 * (`sandboxSharedTierRelease.integration.test.ts`); this guard pins the OTHER half — that Up asks too, through the
 * one verb (`sandboxSharedTier.sh release-in-progress`) and BEFORE it starts anything. Each side sees the other, so
 * neither can begin after the other has passed its own check.
 *
 * The verb's behaviour is the integration suite's. This file proves the wiring: that the step exists, that it runs
 * ahead of the scheduler `start`, and that the job can run `gh run list` at all (`actions: read`).
 *
 * DESIGN PATTERN: Specification module over one workflow — ordering and permissions asserted from its parsed steps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly name?: string;
    readonly run?: string;
}
interface Job {
    readonly permissions?: Readonly<Record<string, string>>;
    readonly steps?: readonly Step[];
}

const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/sandboxUp.yml'), 'utf8')) as {
    readonly jobs: Readonly<Record<string, Job>>;
};
const start = workflow.jobs['start'] as Job;
const steps = start.steps ?? [];
const indexOfRun = (needle: string): number => steps.findIndex((step) => (step.run ?? '').includes(needle));

describe('sandboxUp.yml refuses a press while the shared tier is being released', () => {
    it('asks sandboxSharedTier.sh release-in-progress', () => {
        expect(indexOfRun('sandboxSharedTier.sh release-in-progress')).toBeGreaterThanOrEqual(0);
    });

    it('⛔ asks BEFORE the scheduler start that brings the tier up', () => {
        const ask = indexOfRun('sandboxSharedTier.sh release-in-progress');
        const begin = indexOfRun('sandboxScheduler.sh start');

        expect(begin).toBeGreaterThanOrEqual(0);
        expect(ask).toBeGreaterThanOrEqual(0);
        expect(ask).toBeLessThan(begin);
    });

    it('⛔ refuses on a release (exit 3) AND on a lookup that could not be made — never reads failure as clear', () => {
        const body = steps[indexOfRun('sandboxSharedTier.sh release-in-progress')]?.run ?? '';

        expect(body).toMatch(/::error::/u);
        // Only an exit of exactly 0 lets the press through; every other code falls to an exit 1.
        expect(body).toMatch(/0\)\s*echo/u);
        expect(body).toMatch(/\*\)[\s\S]*exit 1/u);
        expect(body).toMatch(/3\)[\s\S]*exit 1/u);
    });

    it('can list workflow runs — `gh run list` needs actions: read', () => {
        expect(start.permissions?.['actions']).toBe('read');
    });
});
