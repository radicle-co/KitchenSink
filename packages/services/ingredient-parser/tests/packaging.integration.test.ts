/**
 * INTEGRATION TIER — the packaging guard against the asset it will actually ship.
 *
 * `infra/__tests__/packaging.test.ts` proves the predicate can detect a missing model, using fixtures. It
 * cannot prove anything about THIS package: a fixture cannot tell you that pip resolved an arm64 wheel,
 * that the CRF model really travels inside the distribution, or that the archive fits in Lambda's 250 MB
 * unzipped limit. Those live on the far side of a boundary — pip, the network, the filesystem — and
 * _"a unit test that mocks the boundary proves your code calls the mock correctly"_.
 *
 * So this tier RUNS THE BUILD and then interrogates what came out, including the mutation: it removes the
 * model artifact from the real staged tree and asserts the guard reports it, then puts it back.
 *
 * ⚠️ Needs network (pip) and `python3`. It is called by name from `.github/workflows/_ci.yml`, per §7.1 —
 * a non-unit tier CI does not invoke is a tier that does not exist.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { type AssetExpectation, assetViolations, handlerModuleOf } from '../infra/lib/assetContents.js';
import {
    readEngineRecord,
    readHandlerImports,
    readRequirements,
    readStagedAsset,
    readStdlibModules,
} from '../infra/lib/assetInspection.js';
import { ASSET_DIRECTORY, EXTENSION_TAG, HANDLER, TARGET_CPU } from '../infra/lib/packaging.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDirectory = path.join(packageRoot, ASSET_DIRECTORY);

/** Lambda's hard limit on an unzipped zip-packaged function. */
const UNZIPPED_LIMIT_BYTES = 250 * 1024 * 1024;

let expectation: AssetExpectation;
let engineRequirement: string;

beforeAll(() => {
    // The build is the boundary. Running it here — rather than assuming a previous command left a tree
    // behind — is what makes a green run mean "this package can be packaged today".
    execFileSync('npx', ['tsx', 'infra/bin/buildAsset.ts'], { cwd: packageRoot, stdio: 'inherit' });

    const [engine] = readRequirements(path.join(packageRoot, 'requirements.txt'));

    expect(engine, 'requirements.txt declares nothing to install').toBeDefined();
    engineRequirement = String(engine);

    const handlerModule = handlerModuleOf(HANDLER);

    expectation = {
        handlerModule,
        handlerImports: readHandlerImports(path.join(packageRoot, 'src', `${handlerModule}.py`)),
        stdlibModules: readStdlibModules(),
        engineRecord: readEngineRecord(assetDirectory, engineRequirement),
    };
}, 600_000);

describe('the staged asset', () => {
    it('satisfies every derived expectation', () => {
        expect(assetViolations(readStagedAsset(assetDirectory), expectation)).toEqual([]);
    });

    it('carries a manifest with real files in it, so the check above is not vacuous', () => {
        const sized = expectation.engineRecord.filter((entry) => entry.bytes !== undefined);

        expect(sized.length).toBeGreaterThan(0);
        // The CRF model is the reason this package is 90 MB rather than 90 KB. A manifest whose largest
        // entry is source-file sized means pip installed something, but not the model.
        expect(Math.max(...sized.map((entry) => Number(entry.bytes)))).toBeGreaterThan(1_000_000);
    });

    it('reports the model artifact when it is removed — the guard, against the real tree', () => {
        // ⛔ THE MUTATION CHECK, on the filesystem rather than on a fixture. Nothing here names the model:
        // it is found by size in pip's manifest, removed, and the guard is asked what it thinks.
        const sized = expectation.engineRecord.filter((entry) => entry.bytes !== undefined);
        const largest = sized.reduce((left, right) => (Number(left.bytes) >= Number(right.bytes) ? left : right));
        const victim = path.join(assetDirectory, largest.path);
        const rescue = path.join(mkdtempSync(path.join(tmpdir(), 'ingredient-parser-mutation-')), 'artifact');

        copyFileSync(victim, rescue);

        try {
            rmSync(victim);

            const violations = assetViolations(readStagedAsset(assetDirectory), expectation);

            expect(violations.length).toBeGreaterThan(0);
            expect(violations.join(' ')).toContain(largest.path);
        } finally {
            copyFileSync(rescue, victim);
            rmSync(path.dirname(rescue), { recursive: true, force: true });
        }

        // …and the tree is sound again, so a failure above cannot leave a broken asset behind.
        expect(assetViolations(readStagedAsset(assetDirectory), expectation)).toEqual([]);
    });

    it('was built for the Lambda, not for this machine', () => {
        // ⛔ The silent-in-CI, loud-in-production failure: a plain `pip install` resolves wheels for the BUILD
        // host, which install cleanly and raise ImportError on the first arm64 cold start.
        //
        // Stated as "nothing carries the WRONG target", not "everything carries the right one". A wheel also
        // vendors un-tagged shared objects (`numpy.libs/libscipy_openblas64_-….so`) and may ship `abi3`
        // extensions, both of which are correct and carry no interpreter tag — demanding a tag would make
        // the guard fire on a correct asset. The non-vacuity floor below is what keeps that honest.
        const extensions = readStagedAsset(assetDirectory).filter((file) => file.path.endsWith('.so'));
        const otherInterpreter = /cpython-(?<version>\d+)-/u;
        const cpuToken = /-(?<cpu>x86_64|i686|aarch64|armv7l|ppc64le|s390x)-linux/u;

        const wrongTarget = extensions.filter((file) => {
            const interpreter = otherInterpreter.exec(file.path)?.groups?.['version'];
            const cpu = cpuToken.exec(file.path)?.groups?.['cpu'];

            return (
                (interpreter !== undefined && `cpython-${interpreter}` !== EXTENSION_TAG) ||
                (cpu !== undefined && cpu !== TARGET_CPU)
            );
        });

        expect(wrongTarget.map((file) => file.path)).toEqual([]);

        // ⛔ NON-VACUITY. Without this the assertion above passes on an asset with no native code at all —
        // which is exactly what a failed `--only-binary` resolution or a pure-python fallback would produce.
        const onTarget = extensions.filter(
            (file) => file.path.includes(EXTENSION_TAG) && file.path.includes(TARGET_CPU),
        );

        expect(onTarget.length, 'no extension carries the target interpreter and CPU').toBeGreaterThan(0);
    });

    it('resolved wheels, not source builds, for the target', () => {
        // The engine's own distribution is pure python; numpy and python-crfsuite are not. A source build on
        // the build host would produce extensions tagged for THIS machine, which the assertion above catches
        // — this one names the reason: pip must have had a wheel for every native requirement.
        const wheelBuilt = readStagedAsset(assetDirectory).filter((file) => file.path.endsWith('.dist-info/WHEEL'));

        expect(wheelBuilt.length).toBeGreaterThan(0);
    });

    it('fits inside the Lambda unzipped limit', () => {
        const total = readStagedAsset(assetDirectory).reduce((sum, file) => sum + file.bytes, 0);

        expect(total).toBeLessThan(UNZIPPED_LIMIT_BYTES);
    });

    it('carries the handler module the template names', () => {
        expect(existsSync(path.join(assetDirectory, `${handlerModuleOf(HANDLER)}.py`))).toBe(true);
    });
});
