/**
 * ⛔ NO EMF DIMENSION MAY CARRY A PER-USER (OR PER-REQUEST) IDENTIFIER.
 *
 * THE COST, WHICH IS THE POINT. In CloudWatch EMF, **every unique combination of dimension VALUES is a
 * separate billed custom metric**, at ~$0.30/month each with 15-month retention. A dimension whose value is
 * an `identityId` / `userId` therefore has cardinality equal to the user base: 10,000 users is roughly
 * **$3,000/month**, and it buys nothing, because each of those "metrics" holds a single datapoint for a
 * single user and aggregates to nothing you can chart or alarm on. Eight call sites in this service did
 * exactly that. They were free only because the namespace had never received a datapoint — the bill starts
 * the day traffic does.
 *
 * WHY THE IDS ARE NOT MISSED. Every one of these sites already emits the id as a STRUCTURED LOG FIELD
 * through `logger` (`common/observability.ts` → Sentry Logs), which is the correct home for a
 * high-cardinality identifier: searchable per user, not multiplied into a metric namespace. Dimensions are
 * for the low-cardinality facets you group BY (`reason`, `service`, `stage`).
 *
 * AND THE PRIVACY SIDE, which the cost argument obscures. The EMF line is written straight to stdout so it
 * reaches CloudWatch, deliberately bypassing the Sentry log facade — so it also bypasses
 * `sentry-scrubbers.ts`, which PSEUDONYMIZES `sub`/`userId`/`identityId` keys precisely so an erased user
 * cannot be re-identified from log copies (GDPR Art. 17 erasure-of-copies). A raw Clerk `sub` in a dimension
 * is a raw person-linked identifier in CloudWatch, retained for 15 months, outside every scrubber. That is
 * the second reason not to "fix" the cost by moving these ids into an unbilled EMF *property* instead: the
 * scrubbed log facade is where they belong, and a `properties` channel would be a fresh invitation to dump
 * raw ids into CloudWatch.
 *
 * ⚠️ IT PARSES, IT DOES NOT GREP. The prose above says `identityId` and `userId` many times, and so do the
 * docstrings at the call sites explaining this rule — a substring scan would flag its own explanation. The
 * gate walks the TypeScript AST, so only a real `emitMetric(...)` argument can produce a finding.
 *
 * ⚠️ A NON-LITERAL DIMENSION ARGUMENT IS ITSELF A FINDING. A spread or a variable makes the dimension keys
 * unreadable at this level, which would turn the gate silently blind rather than red. Inline the object.
 *
 * @module
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/** `src/`, absolute. `import.meta.dirname` is `src/common/__tests__`. */
const SRC_ROOT = join(import.meta.dirname, '../..');

/**
 * Is this dimension key an identifier — i.e. is its VALUE per-user, per-owner or per-request?
 *
 * The rule is on the key's SHAPE, not a denylist of names, because the next identifier someone reaches for
 * will not be on a list: anything ending in `id` (`identityId`, `userId`, `ownerId`, `requestId`, `eventId`)
 * or `sub`, plus `email`. Low-cardinality facets — `reason`, `stage`, `service`, `leg`, `source` — pass.
 * Pure.
 *
 * @param key - The dimension key as written at the call site.
 * @returns `true` when the key names an identifier and must not be a dimension.
 */
export function isIdentifierShapedDimension(key: string): boolean {
    const normalized = key.toLowerCase();

    return normalized.endsWith('id') || normalized.endsWith('sub') || normalized === 'email';
}

/** One `emitMetric(...)` call found in the tree. */
interface MetricCall {
    /** Repo-relative-ish path, POSIX-separated. */
    readonly file: string;
    /** 1-based line number. */
    readonly line: number;
    /** The metric name, when it is a literal. */
    readonly metricName: string;
    /** The dimension keys, when the third argument is an inline object literal. */
    readonly dimensionKeys: readonly string[];
    /** `true` when a third argument was present but not statically readable (spread, variable, computed). */
    readonly opaqueDimensions: boolean;
}

/**
 * Find every `emitMetric(...)` call in one source, by AST. Pure.
 *
 * @param fileName - Used for diagnostics and in findings.
 * @param source - The file's text.
 * @returns One entry per call site.
 */
export function findMetricCalls(fileName: string, source: string): MetricCall[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const calls: MetricCall[] = [];

    const callee = (node: ts.CallExpression): string | undefined => {
        if (ts.isIdentifier(node.expression)) {
            return node.expression.text;
        }

        return ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && callee(node) === 'emitMetric') {
            const [name, , dimensions] = node.arguments;
            const literalKeys =
                dimensions !== undefined && ts.isObjectLiteralExpression(dimensions)
                    ? dimensions.properties.map((property) =>
                          property.name !== undefined && ts.isIdentifier(property.name)
                              ? property.name.text
                              : (property.name?.getText(sourceFile) ?? '<computed>'),
                      )
                    : [];

            calls.push({
                file: fileName,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                metricName: name !== undefined && ts.isStringLiteralLike(name) ? name.text : '<non-literal>',
                dimensionKeys: literalKeys,
                opaqueDimensions: dimensions !== undefined && !ts.isObjectLiteralExpression(dimensions),
            });
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return calls;
}

/** Every non-test `.ts` file under `src/`. */
async function readSourceFiles(directory: string): Promise<Array<{ path: string; source: string }>> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: Array<{ path: string; source: string }> = [];

    for (const entry of entries) {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === '__tests__') {
                continue;
            }

            files.push(...(await readSourceFiles(full)));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push({ path: full, source: await readFile(full, 'utf8') });
        }
    }

    return files;
}

const metricCalls = (await readSourceFiles(SRC_ROOT)).flatMap(({ path, source }) =>
    findMetricCalls(relative(SRC_ROOT, path).split(sep).join('/'), source),
);

describe('the identifier-shape rule', () => {
    it.each(['identityId', 'userId', 'ownerId', 'requestId', 'eventId', 'clerkSub', 'sub', 'email', 'ID'])(
        'rejects %s',
        (key) => {
            expect(isIdentifierShapedDimension(key)).toBe(true);
        },
    );

    it.each(['reason', 'stage', 'service', 'metric', 'leg', 'source', 'outcome', 'triggerSource'])(
        'admits the low-cardinality facet %s',
        (key) => {
            expect(isIdentifierShapedDimension(key)).toBe(false);
        },
    );
});

describe('the detector parses rather than greps', () => {
    it('reads the dimension keys off a real call', () => {
        expect(findMetricCalls('x.ts', "emitMetric('M', 1, { reason: 'shape' });")).toEqual([
            { file: 'x.ts', line: 1, metricName: 'M', dimensionKeys: ['reason'], opaqueDimensions: false },
        ]);
    });

    it('reports nothing for a call that appears only in prose or a string', () => {
        const source = [
            "/** Never write emitMetric('M', 1, { identityId }) — see the cardinality gate. */",
            'export const doc = "emitMetric(\'M\', 1, { userId })";',
        ].join('\n');

        expect(findMetricCalls('x.ts', source)).toEqual([]);
    });

    it('marks a non-literal dimension argument as opaque rather than skipping it', () => {
        const [call] = findMetricCalls('x.ts', 'emitMetric(name, 1, dims);');

        expect(call?.opaqueDimensions).toBe(true);
    });
});

describe('identity-webhooks EMF dimensions', () => {
    it('found the call sites (non-vacuity — an empty scan is indistinguishable from a clean one)', () => {
        expect(metricCalls.length).toBeGreaterThanOrEqual(10);
    });

    // ⛔ If this fails, do NOT delete the dimension's information — move the identifier into the adjacent
    // `logger.*` call as a structured attribute, where it is searchable AND scrubbed. Read this module's
    // docstring for the arithmetic before deciding anything else.
    it('carries no per-user or per-request identifier as a dimension', () => {
        const findings = metricCalls.flatMap((call) =>
            call.dimensionKeys
                .filter(isIdentifierShapedDimension)
                .map(
                    (key) =>
                        `${call.file}:${call.line} — emitMetric('${call.metricName}') uses '${key}' as a CloudWatch ` +
                        'dimension; every distinct value is a separately billed custom metric',
                ),
        );

        expect(findings).toEqual([]);
    });

    it('passes every dimension bag as an inline object literal, so this gate can read it', () => {
        const opaque = metricCalls
            .filter((call) => call.opaqueDimensions)
            .map((call) => `${call.file}:${call.line} — emitMetric('${call.metricName}') dimensions are not inline`);

        expect(opaque).toEqual([]);
    });
});
