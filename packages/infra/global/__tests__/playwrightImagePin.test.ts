// @vitest-environment node
/**
 * ⛔ THE ACCEPTANCE CRITERION for the Playwright container tag: it must equal the INSTALLED version.
 *
 * The web e2e job runs inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships the browsers
 * and every OS dependency preinstalled — that is what removed `apt` from the shard's critical path, after
 * a package mirror served fonts at 30-60s each and blew every shard's budget.
 *
 * The cost of that is a version COUPLING. The image's bundled browsers are built for one Playwright
 * release; run a different `@playwright/test` against them and the pairing is unsupported — the failure is
 * a confusing runtime mismatch, not a clear "wrong image" error. Nothing in npm or Actions checks it, so a
 * routine dependency bump would drift the two apart silently.
 *
 * This asserts them equal, against `package-lock.json` — the resolved version, never the `^1.60.0` RANGE
 * in `package.json`, which a bump can satisfy while moving the actual install.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The Playwright version npm actually installs, from the lockfile. */
function installedPlaywrightVersion(): string {
    const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
        packages: Record<string, { version?: string }>;
    };
    const entry = Object.entries(lock.packages).find(([key]) => key.endsWith('node_modules/@playwright/test'));

    expect(entry, '@playwright/test is not in package-lock.json').toBeDefined();

    return entry![1].version!;
}

/** The image tag the web e2e job runs in. */
function containerImage(): string {
    const workflow = parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
        jobs: { 'e2e-web': { container?: { image?: string } } };
    };

    return workflow.jobs['e2e-web'].container?.image ?? '';
}

describe('the Playwright container tag tracks the installed version', () => {
    it('⛔ pins the image to exactly the version package-lock resolves', () => {
        const image = containerImage();

        expect(image, 'the web e2e job must run in the official Playwright image').toContain(
            'mcr.microsoft.com/playwright:',
        );
        expect(
            image,
            `image is ${image} but package-lock installs @playwright/test ${installedPlaywrightVersion()}. ` +
                'Bump the tag in `_ci.yml` — the image ships browsers built for one release, and a mismatch ' +
                'surfaces as an unsupported runtime pairing rather than a clear error.',
        ).toBe(`mcr.microsoft.com/playwright:v${installedPlaywrightVersion()}-noble`);
    });

    it('⛔ never installs Playwright browsers or OS deps, which is the point of the image', () => {
        // A re-added `playwright install` would re-introduce the apt dependency this removed, and would do
        // it invisibly: the step would usually succeed and only bite on a bad mirror night.
        const workflow = parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
            jobs: { 'e2e-web': { steps: { name?: string; run?: string }[] } };
        };
        const installs = workflow.jobs['e2e-web'].steps.filter((step) => /playwright\s+install/.test(step.run ?? ''));

        expect(installs.map((s) => s.name ?? s.run)).toStrictEqual([]);
    });
});
