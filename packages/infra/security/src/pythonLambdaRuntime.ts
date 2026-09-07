// ⚠️ DELIBERATE — see docs/architecture/decisions/0025-ingredient-parser-python-deployable.md and
// docs/architecture/decisions/0013-cdk-nag-advisory-iac-security-linting.md (AwsSolutions-L1), plus
// `__tests__/pythonLambdaRuntime.test.ts`, which keeps this pin from falling behind.
//
// THE Python runtime every Python Lambda in this repository runs on. One value, one place — the sibling of
// `lambdaRuntime.ts`, for the same reason and living in the same package: the pin IS the `AwsSolutions-L1`
// supply-chain control, and `@kitchensink/infra-security` is the one package every CDK app already depends
// on.
//
// ## Why this pin cannot simply be "the newest Python CDK knows"
//
// `NODE_LAMBDA_RUNTIME` equals `latestNodeRuntimeKnownToCdk()` because the repository CHOOSES its own Node
// major — nothing outside the repo constrains it. This pin has a second constraint. The only Python Lambda
// here runs `ingredient-parser-nlp`, whose distribution metadata declares:
//
//     Requires-Python: <3.14,>=3.10
//
// while `aws-cdk-lib` already exposes `python3.14`. So "the newest Python runtime" and "the newest Python
// runtime the engine will install on" are two different facts, and shipping the first would produce a
// function whose dependencies cannot be installed for its runtime. The pin is therefore
// `latestPythonRuntimeBelow(ENGINE_PYTHON_CEILING)`, asserted rather than assumed.
//
// ## Why the resulting AwsSolutions-L1 finding is left REPORTING, and NOT suppressed
//
// Same precedent `lambdaRuntime.ts` records for the two `framework-onEvent` functions: the finding is
// ACCURATE (this really is not the newest Python), it is not ours to fix (the ceiling belongs to the
// engine), it clears itself the moment the engine supports the newer Python, and suppressing it would write
// `cdk_nag` metadata into the template in exchange for hiding a genuinely stale runtime later. cdk-nag runs
// ADVISORY here (ADR-0013), so the finding is a warning, not a broken build. What the suite asserts instead
// is that the finding is EXPLAINED: L1 fires on this pin if and only if the ceiling is what holds it below
// CDK's newest — an assertion that flips on its own the day the ceiling moves.
import { Runtime } from 'aws-cdk-lib/aws-lambda';

/**
 * The EXCLUSIVE upper bound on the Python version the ingredient-parse engine supports, `major.minor`.
 *
 * Transcribed from `ingredient-parser-nlp==2.3.0`'s own distribution metadata (`Requires-Python:
 * <3.14,>=3.10`), which is the authority — not a guess and not a policy choice. The engine's pinned version
 * lives in `packages/services/ingredient-parser/requirements.txt`, and that package's own suite asserts the
 * two agree, so this value cannot drift away from the engine it describes.
 *
 * ⛔ Raise this ONLY to what a newer engine release's `Requires-Python` actually admits. Raising it to make
 * an `AwsSolutions-L1` warning go away would ship a function whose wheels cannot be built for its runtime.
 */
export const ENGINE_PYTHON_CEILING = '3.14';

/**
 * The Python Lambda runtime for every Python function this repository defines.
 *
 * Kept equal to the newest `python*` runtime the installed `aws-cdk-lib` knows about that is strictly below
 * {@link ENGINE_PYTHON_CEILING}, asserted by `__tests__/pythonLambdaRuntime.test.ts`.
 */
export const PYTHON_LAMBDA_RUNTIME: Runtime = Runtime.PYTHON_3_13;

/** `major.minor` of a `python…` runtime name, as a sortable pair. `python3.13` → `[3, 13]`. */
function pythonVersionOf(name: string): readonly [number, number] | undefined {
    const matched = /^python(?<major>\d+)\.(?<minor>\d+)$/u.exec(name);
    const major = Number(matched?.groups?.['major']);
    const minor = Number(matched?.groups?.['minor']);

    return Number.isInteger(major) && Number.isInteger(minor) ? [major, minor] : undefined;
}

/** Every versioned `python…` runtime the installed `aws-cdk-lib` exposes, oldest first. */
function pythonRuntimesKnownToCdk(): readonly { readonly name: string; readonly version: readonly [number, number] }[] {
    return Runtime.ALL.map((runtime) => runtime.name)
        .flatMap((name) => {
            const version = pythonVersionOf(name);

            return version === undefined ? [] : [{ name, version }];
        })
        .sort((left, right) => left.version[0] - right.version[0] || left.version[1] - right.version[1]);
}

/**
 * The newest `python*` runtime present in the installed `aws-cdk-lib`, selected the way `AwsSolutions-L1`
 * selects it.
 *
 * This deliberately mirrors cdk-nag's `LambdaLatestVersion` rule, which is FAMILY-GENERIC: it takes the
 * runtime's family prefix and compares against the newest member of that family in `Runtime.ALL`.
 * Reimplementing the selection is what lets a test assert the pin's L1 status is explained; the test then
 * ALSO asserts the answer through the real cdk-nag pack, so this copy cannot silently disagree with the
 * rule it models.
 *
 * ⚠️ Numeric comparison on the `major`/`minor` pair, NOT `localeCompare(..., { numeric: true })`. The Node
 * sibling can use collation because `nodejs22.x`/`nodejs24.x` carry a single number; `python3.9` vs
 * `python3.13` does not survive that treatment on every ICU build, and a wrong answer here is silent.
 *
 * @returns The runtime name, e.g. `python3.14`. Pure.
 */
export function latestPythonRuntimeKnownToCdk(): string {
    const latest = pythonRuntimesKnownToCdk().at(-1);

    if (!latest) {
        throw new Error('python-lambda-runtime: aws-cdk-lib exposes no versioned python runtime, which cannot happen');
    }

    return latest.name;
}

/**
 * The newest `python*` runtime `aws-cdk-lib` knows that is STRICTLY BELOW the given `major.minor` ceiling.
 *
 * @param ceiling - Exclusive upper bound, `major.minor` (e.g. `'3.14'`).
 * @returns The runtime name, e.g. `python3.13`. Pure.
 * @throws When `ceiling` is not `major.minor`, or no known runtime satisfies it — never a fallback, because
 *   a silently-wrong runtime is exactly the failure this module exists to prevent.
 */
export function latestPythonRuntimeBelow(ceiling: string): string {
    const bound = pythonVersionOf(`python${ceiling}`);

    if (bound === undefined) {
        throw new Error(`python-lambda-runtime: ceiling '${ceiling}' is not a major.minor version`);
    }

    const admitted = pythonRuntimesKnownToCdk().filter(
        ({ version }) => version[0] < bound[0] || (version[0] === bound[0] && version[1] < bound[1]),
    );
    const latest = admitted.at(-1);

    if (!latest) {
        throw new Error(`python-lambda-runtime: aws-cdk-lib exposes no python runtime below ${ceiling}`);
    }

    return latest.name;
}
