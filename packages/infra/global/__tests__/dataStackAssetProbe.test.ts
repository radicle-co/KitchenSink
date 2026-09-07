/**
 * ⛔ THE ACCEPTANCE CRITERION for a property CI proved we did not have: ONE synth process must have ONE
 * view of whether the Lambda bundle exists.
 *
 * ## The failure this reproduces, which turned CI red on a docs-only commit
 *
 * `DataStack` decides between the real `dist-lambda/` asset and a loud inline stub by probing the
 * filesystem — `existsSync(lambdaAssetDir)` — and it did so INSIDE the constructor, once per stack. That
 * makes the synthesized template a function of *when* each stack happened to be built, not of the inputs
 * the app was given.
 *
 * `cdkNagSynth.integration.test.ts` runs `npm run bundle:lambda`, which CREATES that directory in the
 * package root. It sits in `__tests__/` and therefore matches the DEFAULT unit glob, so vitest runs it in
 * parallel with every other file in this package. `cdkNagTemplateParity.test.ts` synthesizes the platform
 * TWICE at module scope — `prodPlain` then `prodNagged` — and asserts the two are byte-identical. When the
 * bundle landed between those two lines, the same app synthesized `"codeSource": "inline-stub"` and then
 * `"codeSource": "bundle"`, and the parity proof failed on a diff nobody had authored:
 *
 *     - "codeSource": "inline-stub"      (prodPlain — directory absent)
 *     + "codeSource": "bundle"           (prodNagged — directory now present)
 *
 * Reproduced deterministically by creating `dist-lambda/` 0.95–1.00s into that file's import phase; at
 * 1.05s and later the window has closed and it passes. That is the whole flake: a ~150ms race against a
 * sibling test file, which is why it survived 3/3 clean local runs on a 16-core box and fired on a 2-core
 * runner.
 *
 * ## Why the fix is to pin the probe, not to reorder the tests
 *
 * A template whose SHAPE changes partway through a single `cdk synth` is incoherent independently of any
 * test: `bin/app.ts` builds every stage's stacks in one process, so a bundle appearing mid-synth would
 * emit an app whose stacks disagree about their own handler. Reading the filesystem once, at module load,
 * is what makes the output a function of the inputs. It is also correct for the real path — `npm run
 * deploy` is `bundle:lambda && cdk deploy`, so the bundle is complete before the CDK process starts — and
 * for `cdkNagSynth.integration.test.ts`, which bundles and then synthesizes in a CHILD process that loads
 * this module fresh afterwards.
 *
 * ## Why this test mocks `existsSync` rather than touching `dist-lambda`
 *
 * The honest reproduction is to create the directory mid-run, and that is exactly the shared-state
 * mutation that caused the bug — a test doing it would break its own neighbours the same way. So the probe
 * is toggled in isolation instead: `existsSync` answers `false` the first time it is asked about
 * `dist-lambda` and `true` every time after. Under the defect that yields two different templates; under
 * the fix the second answer is never requested.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, vi } from 'vitest';

const probe = vi.hoisted(() => ({ calls: 0 }));

// Only the `dist-lambda` probe is faked; CDK's own `existsSync` (asset staging, bundling) must stay real,
// so everything else falls through to the actual implementation.
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();

    return {
        ...actual,
        existsSync: (target: Parameters<typeof actual.existsSync>[0]): boolean => {
            if (typeof target === 'string' && target.endsWith('dist-lambda')) {
                probe.calls += 1;

                // A STABLE answer, deliberately. Flipping it mid-run is the honest reproduction, but the
                // `true` half makes CDK stage an asset directory that does not exist (`CannotFindAsset`),
                // and making it exist is precisely the shared-state mutation this file must not perform.
                // So the answer is held constant and the COUNT carries the proof instead.
                return false;
            }

            return actual.existsSync(target);
        },
    };
});

const { DataStack } = await import('../lib/platform/DataStack.js');
const { NetworkStack } = await import('../lib/platform/NetworkStack.js');

const env = { account: '123456789012', region: 'us-east-1' };

/** Synthesizes one `DataStack` the way `GlobalStack` does, in its own app. */
const synthesize = (label: string): Template => {
    const app = new App();
    const network = new NetworkStack(app, `Net-${label}`, { env, stage: 'prod' });

    return Template.fromStack(new DataStack(app, `Data-${label}`, { env, network, stage: 'prod' }));
};

/** The `codeSource` property of the food bootstrap custom resource — the value that moved in CI. */
const codeSourceOf = (template: Template): unknown => {
    const resources = template.findResources('AWS::CloudFormation::CustomResource');
    const bootstrap = Object.values(resources).find(
        (resource) => (resource as { Properties?: { foodDatabaseName?: string } }).Properties?.foodDatabaseName,
    );

    return (bootstrap as { Properties: { codeSource: unknown } }).Properties.codeSource;
};

describe('DataStack bundle probe (one process, one view of dist-lambda)', () => {
    it('⛔ does not re-read the filesystem for each stack it builds', () => {
        // THE assertion. Under the defect the probe runs inside the constructor, so the count grows with
        // every stack — and a second reading is all the race ever needed, whatever it returns. Pinning the
        // reading is what makes the template a function of the app's inputs rather than of when each stack
        // happened to be constructed. Stated as "does not grow" rather than a fixed number, so it stays
        // true if resolution ever checks a different number of candidate paths.
        synthesize('one');
        const afterFirst = probe.calls;

        synthesize('two');
        synthesize('three');

        expect(probe.calls).toBe(afterFirst);
    });

    it('still resolves the bundle state — the probe is pinned, not deleted', () => {
        // Guards the lazy way to satisfy the test above: never probing at all would hold the count flat at
        // zero and ship a stack that can no longer tell a real bundle from a missing one.
        expect(probe.calls).toBeGreaterThan(0);
    });

    it('renders the stub handler for every stack when the bundle is absent', () => {
        // The behaviour that one reading must still drive, asserted on the exact value CI saw move. Both
        // stacks agree BECAUSE they share the reading; a per-construction probe could only agree by luck.
        expect(codeSourceOf(synthesize('four'))).toBe('inline-stub');
        expect(codeSourceOf(synthesize('five'))).toBe('inline-stub');
    });
});
