/**
 * The packaging facts the stack, the build script and the guard must all agree on — stated once.
 *
 * Small on purpose, and none of it is a comment. `HANDLER` is what CDK writes into the template AND what
 * the build derives the required module from, so a second spelling would let the deployed function name a
 * module the guard never checked — this package's own failure mode, reintroduced one layer up. `PIP_TARGET`
 * is the interpreter and CPU the wheels are built for, and it MUST match the function's `runtime` and
 * `architecture`: a mismatch produces an asset that installs cleanly on the build host and raises
 * `ImportError` on the first cold start in production. `__tests__/packaging.test.ts` asserts that agreement
 * rather than trusting this docstring.
 */
import { PYTHON_LAMBDA_RUNTIME } from '@kitchensink/infra-security';
import { Architecture } from 'aws-cdk-lib/aws-lambda';

/**
 * The Lambda `handler:` string — `handle` in `handler.py`, staged at the asset root.
 *
 * `assetContents.ts`'s `handlerModuleOf` splits this at its last dot, exactly as W2's
 * `entryPointForHandler` does for the Node services, so a nested layout would work without changing either.
 */
export const HANDLER = 'handler.handle';

/** Where `npm run bundle:lambda` stages the asset, relative to the package root. Gitignored build output. */
export const ASSET_DIRECTORY = 'build/asset';

/**
 * Where the NLTK tagger corpus is staged INSIDE the asset, relative to the asset root.
 *
 * ⛔ Load-bearing, and the reason this is a constant rather than two strings. The engine's `_utils.py` calls
 * `download_nltk_resources()` at import, which asks `nltk.data.find` for three tagger files and, failing to
 * find them, calls `nltk.download(…)` — a write to `$HOME`, which on Lambda is read-only. The first deploy
 * of this function died exactly that way. `buildAsset.ts` stages the corpus HERE and the stack points
 * `NLTK_DATA` at the same place ({@link NLTK_DATA_PATH}); if the two ever disagreed, the function would go
 * back to reaching for the network at cold start.
 */
export const NLTK_DATA_DIRECTORY = 'nltk_data';

/**
 * The directory Lambda unpacks a zip-packaged function into.
 *
 * A published AWS constant (`LAMBDA_TASK_ROOT`), stated once so the `NLTK_DATA` value below is not a
 * literal path buried in the stack.
 */
export const LAMBDA_TASK_ROOT = '/var/task';

/**
 * The `NLTK_DATA` the deployed function runs with — an ABSOLUTE path, because that is all nltk accepts.
 *
 * `nltk/data.py` puts `$NLTK_DATA` at the FRONT of its search path, ahead of `~/nltk_data` and the
 * `sys.prefix` locations, none of which exist on Lambda. Setting it is what turns the engine's lookup from
 * a `LookupError` (→ download → crash) into a hit on a file that shipped in the asset.
 */
export const NLTK_DATA_PATH = `${LAMBDA_TASK_ROOT}/${NLTK_DATA_DIRECTORY}`;

/** The CPU the function runs on. ARM matches every other Lambda here and is ~20% cheaper per GB-second. */
export const LAMBDA_ARCHITECTURE = Architecture.ARM_64;

/**
 * What pip must build the dependency wheels FOR.
 *
 * ⚠️ Derived from the runtime pin, not written twice: `python3.13` → `3.13`. The platform tag is the one
 * numpy and python-crfsuite publish arm64 wheels under (`manylinux_2_17_aarch64` is the same tag), verified
 * by actually downloading them. `--only-binary=:all:` in the build turns "no wheel exists for this target"
 * into a loud failure instead of a silent source build for the BUILD host's platform.
 */
export const PIP_TARGET = {
    pythonVersion: PYTHON_LAMBDA_RUNTIME.name.replace(/^python/u, ''),
    platforms: ['manylinux2014_aarch64'],
    implementation: 'cp',
} as const;

/**
 * The ABI tag pip puts in a WHEEL filename for {@link PIP_TARGET} — `cp313` for CPython 3.13.
 *
 * ⚠️ NOT the same string a compiled extension carries. Wheels are `…-cp313-cp313-manylinux…whl`; the
 * extension modules inside them are `…cpython-313-aarch64-linux-gnu.so`. Measured, after a guard written
 * against the wheel form reported every correct `.so` in numpy as wrongly targeted.
 */
export const ABI_TAG = `${PIP_TARGET.implementation}${PIP_TARGET.pythonVersion.replace('.', '')}`;

/** The interpreter tag a compiled EXTENSION carries in its filename — `cpython-313` for CPython 3.13. */
export const EXTENSION_TAG = `cpython-${PIP_TARGET.pythonVersion.replace('.', '')}`;

/**
 * The CPU token wheel platform tags and extension filenames both use — `aarch64` for arm64.
 *
 * Taken from the platform tag's own last segment rather than written down, so it cannot disagree with what
 * pip was actually told to fetch.
 */
export const TARGET_CPU = PIP_TARGET.platforms[0].split('_').at(-1) ?? '';
