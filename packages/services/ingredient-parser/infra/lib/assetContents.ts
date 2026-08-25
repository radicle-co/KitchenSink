/**
 * THE PACKAGING PREDICATE — is this staged directory a Lambda asset that can actually start?
 *
 * DESIGN PATTERN: a **Specification/policy module**, the same shape as `evaluateVisibility` and
 * `mappingScopePolicy` — pure, total, table-testable, no I/O. Everything that touches the filesystem or the
 * interpreter lives in `assetInspection.ts`, so this file can be fired at a deliberately-violating fake.
 * That separation is what makes the mutation check in `__tests__/packaging.test.ts` possible at all.
 *
 * ## Why a predicate and not a test
 *
 * A test catches a bad asset in CI. This runs in `infra/bin/buildAsset.ts` too, so a bad asset is never
 * PRODUCED — the build fails at the machine that assembled it, with the missing file named. The guard test
 * then proves the predicate can detect the failure; the two are the same code, so they cannot drift.
 *
 * ## ⛔ Nothing here is a list
 *
 * `handle-sync-worker` shipped 4.6 KB of unbundled output past two green guards because both _"enumerated
 * the same five names… a copy of a list cannot detect that the list is incomplete."_ So every expectation
 * this module consumes is DERIVED by its caller — the handler module from the CDK `handler:` string, the
 * imports from the handler's own Python AST, the stdlib set from `sys.stdlib_module_names`, and every
 * engine file from **pip's own `RECORD`**. Nobody has to know that the CRF model is called
 * `model.en.crfsuite`, and nobody has to remember to add it here when it is renamed.
 */

/** One file in the staged asset directory. */
export interface StagedFile {
    /** Path relative to the staging root, POSIX separators. */
    readonly path: string;
    /** Size on disk, bytes. */
    readonly bytes: number;
}

/**
 * One row of pip's `RECORD` manifest.
 *
 * `bytes` is `undefined` for the rows pip writes without a hash or size — compiled `.pyc` files, which may
 * or may not exist in any given install. Requiring those would make the guard fire on a correct asset.
 */
export interface RecordedFile {
    /** Path relative to the install target, POSIX separators. */
    readonly path: string;
    /** Declared size in bytes, or `undefined` when pip recorded none. */
    readonly bytes: number | undefined;
}

/** Everything the predicate needs, all of it derived by the caller from a source it does not control. */
export interface AssetExpectation {
    /** The handler's module path, from the CDK `handler:` string (see {@link handlerModuleOf}). */
    readonly handlerModule: string;
    /** Root module names the handler imports, from its Python AST. */
    readonly handlerImports: readonly string[];
    /** Module names the interpreter itself provides — `sys.stdlib_module_names`, never a hand-written set. */
    readonly stdlibModules: readonly string[];
    /** pip's `RECORD` rows for the engine distribution. */
    readonly engineRecord: readonly RecordedFile[];
}

/**
 * Whether a staged asset provides an importable target for a top-level module name.
 *
 * Three forms count, because all three are how a dependency legitimately arrives in a `pip --target`
 * install: a module file, a package directory, and a bare native extension (`python-crfsuite` installs as
 * `_pycrfsuite.cpython-313-x86_64-linux-gnu.so` with no directory of its own).
 */
function providesModule(staged: readonly StagedFile[], module: string): boolean {
    return staged.some(
        ({ path }) =>
            path === `${module}.py` ||
            path.startsWith(`${module}/`) ||
            (path.startsWith(`${module}.`) && path.endsWith('.so')),
    );
}

/**
 * The module path a CDK `handler:` string names, i.e. everything before its LAST dot.
 *
 * `handler.handle` → `handler`. Generic over layouts by construction — `parse/handler.handle` →
 * `parse/handler` — exactly as W2's `entryPointForHandler` is for the Node services.
 *
 * @param handler - The CDK `handler:` string.
 * @returns The module path, without extension. Pure.
 * @throws When the string carries no exported symbol, which would otherwise resolve to an empty module
 *   name and make every downstream check pass against nothing.
 */
export function handlerModuleOf(handler: string): string {
    const lastDot = handler.lastIndexOf('.');

    if (lastDot <= 0) {
        throw new Error(
            `asset-contents: handler '${handler}' names no exported symbol — expected '<module>.<function>'`,
        );
    }

    return handler.slice(0, lastDot);
}

/**
 * The `.dist-info` directory name pip writes for an exactly-pinned requirement.
 *
 * PEP 503/427 normalisation: the distribution name is lower-cased and every run of `-`, `_` or `.` becomes
 * a single `_`, so `ingredient-parser-nlp==2.3.0` is installed as `ingredient_parser_nlp-2.3.0.dist-info`.
 * Deriving the directory rather than writing it down is what lets the requirement be re-spelled without
 * silently disconnecting the guard from the distribution it is supposed to be reading.
 *
 * @param requirement - One `name==version` line from `requirements.txt`.
 * @returns The dist-info directory name, relative to the install target. Pure.
 * @throws When the requirement is not pinned with `==` — an unpinned engine has no dist-info name to look
 *   for, and would let the shipped model change without a diff.
 */
export function distInfoDirectory(requirement: string): string {
    const [name, version, ...rest] = requirement.split('==');

    if (name === undefined || version === undefined || rest.length > 0 || name === '' || version === '') {
        throw new Error(`asset-contents: requirement '${requirement}' is not pinned as 'name==version'`);
    }

    return `${name.toLowerCase().replace(/[-_.]+/gu, '_')}-${version}.dist-info`;
}

/**
 * Every reason this staged asset would fail at cold start.
 *
 * @param staged - The staged asset's files (see `assetInspection.readStagedAsset`).
 * @param expectation - What must be there, each part derived from something outside this module.
 * @returns One human-readable finding per problem, empty when the asset is sound. Pure.
 */
export function assetViolations(staged: readonly StagedFile[], expectation: AssetExpectation): readonly string[] {
    const violations: string[] = [];

    // Two vacuity floors FIRST, and reported as findings rather than thrown: if either subject set is
    // empty, every check below is checking nothing and would otherwise report success.
    if (staged.length === 0) {
        violations.push('the staged asset is empty — nothing was packaged, so the function has no code to run');
    }

    if (expectation.engineRecord.length === 0) {
        violations.push(
            'the engine packaging manifest (pip RECORD) is empty or was not found — the per-file check below ' +
                'would pass against nothing, which is how a guard silently stops guarding',
        );
    }

    if (!providesModule(staged, expectation.handlerModule)) {
        violations.push(
            `the asset does not carry the handler module '${expectation.handlerModule}.py' — the function ` +
                'would fail at cold start with Runtime.ImportModuleError',
        );
    }

    const stdlib = new Set(expectation.stdlibModules);

    for (const module of expectation.handlerImports) {
        if (stdlib.has(module) || providesModule(staged, module)) {
            continue;
        }

        violations.push(
            `the handler imports '${module}', which the interpreter does not provide and the asset does not ` +
                'carry — the function would fail at cold start with ModuleNotFoundError',
        );
    }

    const stagedByPath = new Map(staged.map((file) => [file.path, file.bytes]));

    for (const recorded of expectation.engineRecord) {
        if (recorded.bytes === undefined) {
            continue;
        }

        const actual = stagedByPath.get(recorded.path);

        if (actual === undefined) {
            violations.push(`the asset is missing the engine file '${recorded.path}', which pip recorded installing`);
            continue;
        }

        if (actual !== recorded.bytes) {
            violations.push(
                `the engine file '${recorded.path}' is ${actual} bytes but pip recorded ${recorded.bytes} — a ` +
                    'truncated or substituted artifact loads worse than a missing one',
            );
        }
    }

    return violations;
}
