/**
 * ⛔ NO CLOUDWATCH EMF DIMENSION, IN ANY SERVICE, MAY CARRY A PER-USER OR PER-REQUEST IDENTIFIER.
 *
 * ── HAZARD 1: COST, WHICH IS WHAT MAKES THIS URGENT ──
 *
 * In CloudWatch's Embedded Metric Format, **every distinct combination of dimension VALUES is a separately
 * billed custom metric** — ~$0.30/month each, with 15-month retention that keeps charging after the traffic
 * stops. A dimension keyed `userId` therefore has cardinality equal to the user base: at 10,000 users that is
 * roughly **$3,000/month**, and it buys nothing, because each of those "metrics" holds one datapoint for one
 * user and aggregates to nothing you can chart or alarm on. `identity-webhooks` shipped exactly that at eight
 * call sites (fixed in `06107d97`); it was free only because the namespace had never received a datapoint.
 *
 * ── HAZARD 2: PRIVACY, WHICH IS NARROWER AND POINTS SOMEWHERE ELSE ──
 *
 * The EMF line is written straight to stdout so CloudWatch can extract it, which deliberately bypasses the
 * Sentry log facade — and therefore bypasses `sentry-scrubbers.ts`, the one place that pseudonymises
 * `sub`/`userId`/`identityId` so an erased user cannot be re-identified from log copies (GDPR Art. 17
 * erasure-of-copies). A raw **external** identifier there — a Clerk `sub` — is a person-linked value sitting
 * in CloudWatch for 15 months outside every scrubber.
 *
 * ⚠️ Which is why the obvious cost fix is the WRONG fix. Moving an id from a dimension into an unbilled EMF
 * *property* stops the bill and leaves hazard 2 fully intact. **The scrubbed structured-log line is where an
 * identifier belongs** — `logger.warn(message, { userId })`, next to the emission, searchable per user and
 * pseudonymised on the way out. This is written down here because it is the "optimisation" a future reader
 * will reach for, and the gate below cannot see it: the gate reads dimensions, not properties.
 *
 * The two hazards have deliberately different scopes, and conflating them produces bad advice:
 *
 *  - Hazard 1 fires on **any** high-cardinality dimension VALUE, pseudonymous or not. An app-side ULID costs
 *    exactly as much as a Clerk `sub`.
 *  - Hazard 2 fires on a **raw external** identifier. A bare app ULID is already this repo's pseudonymous
 *    form — `scrubText` leaves one alone by design — which is why
 *    `recipe-service/src/account/erasure-metrics.ts` keeping `ownerId` as an EMF *property* (never a
 *    dimension, and documented as such) is correct and is not a finding here.
 *
 * ── WHAT THIS GATE IS, AND WHY IT IS REPO-WIDE ──
 *
 * The identity fix came with a guard, but scoped to identity-webhooks, and keyed on that service's own
 * `emitMetric(name, value, dimensions)` signature by POSITION — so it would have gone silently blind the day
 * the signature changed, and it said nothing about the other three emitters in the tree. `food-service` has
 * the identical arbitrary-dimension bag and is clean today only by habit. This gate replaces it: one rule,
 * one author, every service.
 *
 * Services are DISCOVERED from each `packages/services/<name>/package.json` (`serviceSources.ts`), never listed —
 * a sixth service is covered the day its manifest lands and cannot opt out by not being mentioned (GR-017:
 * "a hardcoded list is itself the defect").
 *
 * ── WHY AN ALLOWLIST OF FACETS AND NOT A DENYLIST OF ID-SHAPED NAMES ──
 *
 * The rejected alternative is the identity guard's rule: reject `*id`, `*sub`, `email`. It is defeated by the
 * identifier nobody thought of — `clerkUserKey`, `sessionToken`, `deviceFingerprint`, `ownerHandle`,
 * `recipeSlug`, `query`, `normalizedName` — every one high-cardinality, none matching. The failure mode this
 * gate exists for is precisely the unanticipated key, so the check must be **closed by construction**:
 * unknown ⇒ reject. The cost is that a genuinely new facet needs a one-line edit to
 * {@link ALLOWED_DIMENSION_FACETS} — which is the review moment we want, because adding a dimension key
 * multiplies the billed series count AND changes what `service-infra-wiring-invariants.test.ts`'s W4 requires
 * of every alarm on that namespace.
 *
 * ── HOW IT READS THE TREE (the anchor is the AWS spec, not our naming) ──
 *
 * An emitter is found by `_aws.CloudWatchMetrics[].Dimensions` — the one place the EMF contract is expressed
 * in code, fixed by AWS rather than by us. Rename `emitMetric` to anything and the gate still finds it; delete
 * the `_aws` envelope and the line stops being EMF at all. (W4 uses the same anchor for a different question.)
 * From each directive:
 *
 *  - string-literal elements are dimension keys the emitter attaches itself (`[['Stage']]`,
 *    `[['service', 'metric', …]]`);
 *  - a non-literal element (a variable, a spread) means the keys arrive from CALLERS, so the gate traces that
 *    expression back through the emitter's local `const`s to the parameter it came from — yielding a SEAM
 *    (argument index, plus a property when the bag is nested inside an options object) — and then reads the
 *    bag at every call site of that emitter in the service.
 *
 * ⚠️ THREE WAYS THIS GATE COULD LIE, EACH ASSERTED AGAINST RATHER THAN HOPED ABOUT:
 *
 *  1. **It parses, it does not grep.** The prose above names `userId` and `identityId` many times, and so do
 *     the call sites' own explanatory comments. A textual scan would report its own rationale as a violation,
 *     and a gate that fires on its own rationale gets deleted. Only a real call argument can produce a
 *     finding — asserted by {@link findMetricCalls} over a file where the only occurrences are a comment and
 *     a string.
 *  2. **A bag it cannot read is a FINDING, not a pass.** A spread or a variable at the call site would make
 *     the keys invisible; that reports as unreadable. Inline the object literal.
 *  3. **A seam it cannot trace is a FINDING, not a pass.** An open emitter whose dimension source cannot be
 *     followed back to a parameter would make every call-site loop iterate zero times and pass vacuously —
 *     the exact shape of a renamed-helper false green. That reports as blind. And the real-tree suite asserts
 *     NON-VACUITY FIRST: that services were discovered, that emitters were found, and that BOTH extraction
 *     paths (emitter literals and call-site seams) yielded at least one real key.
 *
 * @module
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    discoverServices,
    isInfraFile,
    isTestFile,
    literalText,
    objectProperties,
    parse,
    visit,
    type DiscoveredService,
    type SourceFile,
} from './serviceSources.js';

// ───────────────────────────── the rule ─────────────────────────────

/**
 * The dimension keys a CloudWatch EMF metric in this repo is allowed to be grouped by, each with the reason
 * its VALUE space is bounded. Lookup is case-insensitive, so `Stage` and `stage` are one entry.
 *
 * A key is admitted because someone can state the bound, not because it looks harmless. Adding an entry is a
 * deliberate decision with two consequences — the billed series count multiplies by the new key's cardinality,
 * and W4 will require every alarm on that namespace to select the key if the emitter attaches it
 * unconditionally — so state the bound in the value here.
 */
export const ALLOWED_DIMENSION_FACETS: ReadonlyMap<string, string> = new Map([
    ['service', 'the emitting service — exactly one value per deployed service'],
    ['metric', 'the metric name — bounded by the emitter’s own metric-name constants (tens)'],
    [
        'stage',
        'the deploy stage — prod | sandbox | pr-{N}; grows only with previews ever opened, and stale series ' +
            'age out of the 15-month window',
    ],
    ['source', 'the wired upstream data source — bounded by the registered source adapters'],
    ['reason', 'a closed union of failure reasons declared in the emitting module (e.g. shape | signature)'],
]);

/**
 * Is this dimension key one of the bounded facets a metric may be grouped by? Pure.
 *
 * @param key - The dimension key as written in the emitter or at the call site.
 * @returns `true` when the key is an allowlisted low-cardinality facet.
 */
export function isAllowedDimensionFacet(key: string): boolean {
    return ALLOWED_DIMENSION_FACETS.has(key.toLowerCase());
}

// ───────────────────────────── mechanism ─────────────────────────────

/** Where a caller's dimension bag enters an emitter. */
export interface DimensionSeam {
    /** Zero-based argument index the bag is passed in. */
    readonly argumentIndex: number;
    /** Property name when the bag is nested inside an options object, else `undefined`. */
    readonly property: string | undefined;
}

/** One EMF emitter: a function whose body writes an `_aws.CloudWatchMetrics` directive. */
export interface EmfEmitter {
    /** Repo-relative path. */
    readonly file: string;
    /** 1-based line of the directive. */
    readonly line: number;
    /** The declared name of the enclosing function, when it has one. */
    readonly name: string | undefined;
    /** Dimension keys the directive lists as string literals. */
    readonly literalKeys: readonly string[];
    /** `true` when the directive's dimension array holds a non-literal element, so callers supply keys. */
    readonly open: boolean;
    /** Where caller-supplied keys enter, when the gate could trace it. */
    readonly seam: DimensionSeam | undefined;
}

/** One call to an emitter, with whatever the gate could read of its dimension bag. */
export interface MetricCall {
    /** Repo-relative path. */
    readonly file: string;
    /** 1-based line of the call. */
    readonly line: number;
    /** The callee's name as written. */
    readonly callee: string;
    /** The dimension keys, when the bag is an inline object literal. */
    readonly dimensionKeys: readonly string[];
    /** `true` when a bag was passed but is not statically readable (a variable, a spread, a computed key). */
    readonly unreadable: boolean;
    /** Set when the bag is the enclosing function's own parameter, making that function an emitter too. */
    readonly forwards: { readonly name: string; readonly seam: DimensionSeam } | undefined;
}

/** One dimension key attributed to where it came from. */
export interface DimensionKeySite {
    /** The key. */
    readonly key: string;
    /** Repo-relative path. */
    readonly file: string;
    /** 1-based line. */
    readonly line: number;
    /** Whether the emitter attaches the key itself or a caller supplies it. */
    readonly origin: 'emitter' | 'call-site';
}

/** Anything with a body that could hold an EMF directive. */
type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

/**
 * The 1-based line a node's first real token sits on.
 *
 * `node.pos` includes leading trivia, so using it directly would attribute a finding to the comment ABOVE the
 * offending call — and these findings exist to be pasted into an editor. `getStart(source)` skips that trivia,
 * and takes the source file explicitly because `serviceSources.parse` omits the parent pointers it would
 * otherwise use to find it.
 *
 * @param source - The parsed file.
 * @param node - The node to locate.
 * @returns The 1-based line number.
 */
function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * Walk every node beneath any node — `serviceSources.visit` only accepts a whole `SourceFile`, and the seam
 * trace has to look inside one function's body.
 *
 * @param root - Where to start.
 * @param callback - Invoked once per descendant, pre-order, including `root`.
 */
function walk(root: ts.Node, callback: (node: ts.Node) => void): void {
    callback(root);
    ts.forEachChild(root, (child) => walk(child, callback));
}

/** Whether a node is a function-like with a body the gate can look inside. */
function isFunctionLike(node: ts.Node): node is FunctionLike {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
    );
}

/**
 * Declared names for function-like nodes, keyed by node position.
 *
 * `serviceSources.parse` omits parent pointers, so an arrow function cannot ask for the `const` it was
 * assigned to. This walks the declarations that NAME a function instead — `function f()`, `const f = () => {}`,
 * `f() {}` in a class — and indexes by the function node's own `pos`.
 *
 * @param source - The parsed file.
 * @returns Function node position → declared name.
 */
function functionNames(source: ts.SourceFile): ReadonlyMap<number, string> {
    const names = new Map<number, string>();

    visit(source, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
            names.set(node.pos, node.name.text);
        }

        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            isFunctionLike(node.initializer)
        ) {
            names.set(node.initializer.pos, node.name.text);
        }

        if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
            names.set(node.pos, node.name.text);
        }
    });

    return names;
}

/**
 * The object-literal keys of a dimension bag, or `undefined` when the bag is not statically readable.
 *
 * Shorthand (`{ source }`) counts — it is the commonest way a dimension is passed and skipping it would make
 * the gate blind to the ordinary case. A spread or a computed key makes the whole bag unreadable, because the
 * gate cannot enumerate what it contributes.
 *
 * @param node - The expression a caller passed as the bag.
 * @returns The keys, or `undefined` when unreadable.
 */
export function bagKeys(node: ts.Expression | undefined): readonly string[] | undefined {
    if (node === undefined) {
        return [];
    }

    if (!ts.isObjectLiteralExpression(node)) {
        return undefined;
    }

    const keys: string[] = [];

    for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
            return undefined;
        }

        const name = property.name;

        if (name === undefined || (!ts.isIdentifier(name) && !ts.isStringLiteral(name))) {
            return undefined;
        }

        keys.push(name.text);
    }

    return keys;
}

/**
 * Every `_aws.CloudWatchMetrics[].Dimensions` array literal in a parsed file, with its elements.
 *
 * @param source - The parsed file.
 * @returns One entry per directive that declares dimensions.
 */
function dimensionDirectives(source: ts.SourceFile): ReadonlyArray<{ node: ts.ArrayLiteralExpression }> {
    const found: Array<{ node: ts.ArrayLiteralExpression }> = [];

    visit(source, (node) => {
        if (!ts.isObjectLiteralExpression(node)) {
            return;
        }

        const directives = objectProperties(node).get('CloudWatchMetrics');

        if (directives === undefined || !ts.isArrayLiteralExpression(directives)) {
            return;
        }

        for (const directive of directives.elements) {
            if (!ts.isObjectLiteralExpression(directive)) {
                continue;
            }

            const dimensions = objectProperties(directive).get('Dimensions');

            if (dimensions !== undefined && ts.isArrayLiteralExpression(dimensions)) {
                found.push({ node: dimensions });
            }
        }
    });

    return found;
}

/**
 * Trace an expression inside an emitter back to the parameter a caller's dimension keys arrive through.
 *
 * Three hops cover every emitter in the tree and any shape written the same way:
 *  - `Object.keys(x)` / `...x` → follow into the operand;
 *  - a local `const k = <init>` → follow the initializer (and a `??`/`||` default → follow the left side);
 *  - `p` or `p.q` where `p` is a parameter → the seam.
 *
 * Returns `undefined` for anything else, which the caller reports as a BLIND emitter rather than treating as
 * "no dimensions" — a silent zero here is how a gate passes vacuously forever.
 *
 * @param expression - The non-literal element found in the `Dimensions` array.
 * @param fn - The emitter function the element sits inside.
 * @returns The seam, or `undefined` when it cannot be traced.
 */
function traceSeam(expression: ts.Expression, fn: FunctionLike): DimensionSeam | undefined {
    const parameterIndex = (name: string): number =>
        fn.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name);

    const locals = new Map<string, ts.Expression>();

    if (fn.body !== undefined) {
        walk(fn.body, (node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
                locals.set(node.name.text, node.initializer);
            }
        });
    }

    const follow = (node: ts.Expression, depth: number): DimensionSeam | undefined => {
        if (depth > 8) {
            return undefined;
        }

        if (ts.isSpreadElement(node)) {
            return follow(node.expression, depth + 1);
        }

        if (ts.isCallExpression(node)) {
            // A call moves the bag along one of two routes and the gate cannot tell them apart by name:
            // `Object.keys(bag)` / `Object.fromEntries(bag)` carry it in ARGUMENT 0, while `bag.filter(fn)` /
            // `bag.map(fn)` carry it in the RECEIVER and put a callback in argument 0. Trying argument 0 alone
            // is what made `buildEmf`'s own `Object.entries(...).filter(...)` chain untraceable — the gate
            // reported itself blind rather than passing, which is the designed failure but still a false
            // positive. So try both routes and take whichever reaches a parameter.
            const [first] = node.arguments;
            const viaArgument = first === undefined ? undefined : follow(first, depth + 1);

            if (viaArgument !== undefined) {
                return viaArgument;
            }

            return ts.isPropertyAccessExpression(node.expression)
                ? follow(node.expression.expression, depth + 1)
                : undefined;
        }

        if (ts.isBinaryExpression(node)) {
            return follow(node.left, depth + 1);
        }

        if (ts.isParenthesizedExpression(node)) {
            return follow(node.expression, depth + 1);
        }

        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
            const index = parameterIndex(node.expression.text);

            return index === -1 ? undefined : { argumentIndex: index, property: node.name.text };
        }

        if (ts.isIdentifier(node)) {
            const index = parameterIndex(node.text);

            if (index !== -1) {
                return { argumentIndex: index, property: undefined };
            }

            const local = locals.get(node.text);

            return local === undefined ? undefined : follow(local, depth + 1);
        }

        return undefined;
    };

    return follow(expression, 0);
}

/** A parsed file plus the two indexes every scan below needs. */
interface ParsedSource {
    /** The parsed file. */
    readonly source: ts.SourceFile;
    /** Every function-like with a body, in source order. */
    readonly functions: readonly FunctionLike[];
    /** Function node position → declared name. */
    readonly names: ReadonlyMap<number, string>;
}

/**
 * Parse a file once and index its functions.
 *
 * @param file - The file to read.
 * @returns The parse plus its function indexes.
 */
function parseWithFunctions({ file, contents }: SourceFile): ParsedSource {
    const source = parse({ file, contents });
    const functions: FunctionLike[] = [];

    visit(source, (node) => {
        if (isFunctionLike(node) && node.body !== undefined) {
            functions.push(node);
        }
    });

    return { source, functions, names: functionNames(source) };
}

/**
 * The INNERMOST function containing a node, so a module-level wrapper around the real emitter does not steal
 * its parameter list.
 *
 * @param parsed - The parsed file.
 * @param node - The node to attribute.
 * @returns The enclosing function, or `undefined` at module scope.
 */
function enclosingFunction(parsed: ParsedSource, node: ts.Node): FunctionLike | undefined {
    return parsed.functions
        .filter((fn) => fn.pos <= node.pos && node.end <= fn.end)
        .sort((a, b) => a.end - a.pos - (b.end - b.pos))[0];
}

/**
 * Every EMF emitter in one source file.
 *
 * @param file - The file to read.
 * @returns One entry per `Dimensions` directive found.
 */
export function findEmfEmitters(file: SourceFile): readonly EmfEmitter[] {
    const parsed = parseWithFunctions(file);
    const { source, names } = parsed;

    return dimensionDirectives(source).map(({ node }) => {
        const enclosing = enclosingFunction(parsed, node);
        const literalKeys: string[] = [];
        const openElements: ts.Expression[] = [];

        for (const set of node.elements) {
            if (!ts.isArrayLiteralExpression(set)) {
                openElements.push(set);

                continue;
            }

            for (const element of set.elements) {
                const text = literalText(element);

                if (text === undefined) {
                    openElements.push(element);
                } else {
                    literalKeys.push(text);
                }
            }
        }

        const traced = openElements.flatMap((element) => {
            const seam = enclosing === undefined ? undefined : traceSeam(element, enclosing);

            return seam === undefined ? [] : [seam];
        });

        return {
            file: file.file,
            line: lineOf(source, node),
            name: enclosing === undefined ? undefined : names.get(enclosing.pos),
            literalKeys,
            open: openElements.length > 0,
            seam: traced[0],
        };
    });
}

/**
 * Every call to one of `seams`' emitters in a source file, with the dimension bag read through the seam.
 *
 * ⚠️ THE FORWARDING CASE IS NOT AN UNREADABLE BAG, and getting that wrong is what the first run of this gate
 * did. `food-service` splits its emitter in two — `emitMetric(input, sink)` hands its whole `input` to
 * `buildEmf(input)`, and the directive lives in `buildEmf` — so the seam the directive yields belongs to
 * `buildEmf`, whose only caller passes a PARAMETER rather than a literal. Reporting that as unreadable would
 * fail a correct service AND still never look at the real call sites. A bag that is the enclosing function's
 * own parameter is therefore recorded as a FORWARD, which {@link dimensionSeams} propagates outward to the
 * wrapper until it reaches the calls that actually write keys.
 *
 * @param file - The file to read.
 * @param seams - Callee name → where its dimension bag arrives.
 * @returns One entry per matching call.
 */
export function findMetricCalls(file: SourceFile, seams: ReadonlyMap<string, DimensionSeam>): readonly MetricCall[] {
    const parsed = parseWithFunctions(file);
    const { source } = parsed;
    const calls: MetricCall[] = [];

    visit(source, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : undefined;
        const seam = callee === undefined ? undefined : seams.get(callee);

        if (callee === undefined || seam === undefined) {
            return;
        }

        const argument = node.arguments[seam.argumentIndex];
        const forwards = forwardedSeam(parsed, node, argument, seam);

        if (forwards !== undefined) {
            calls.push({
                file: file.file,
                line: lineOf(source, node),
                callee,
                dimensionKeys: [],
                unreadable: false,
                forwards,
            });

            return;
        }

        const bag =
            seam.property === undefined || argument === undefined
                ? argument
                : ts.isObjectLiteralExpression(argument)
                  ? objectProperties(argument).get(seam.property)
                  : /* an options object the gate cannot open */ argument;
        const keys = bagKeys(bag);

        calls.push({
            file: file.file,
            line: lineOf(source, node),
            callee,
            dimensionKeys: keys ?? [],
            unreadable: keys === undefined,
            forwards: undefined,
        });
    });

    return calls;
}

/**
 * When a call passes its OWN enclosing function's parameter as the dimension bag, the seam the callee has is
 * inherited by that enclosing function.
 *
 * @param parsed - The parsed file.
 * @param call - The call being read.
 * @param argument - The argument sitting at the callee's seam.
 * @param seam - The callee's seam.
 * @returns The inherited emitter name + seam, or `undefined` when this is not a forward.
 */
function forwardedSeam(
    parsed: ParsedSource,
    call: ts.CallExpression,
    argument: ts.Expression | undefined,
    seam: DimensionSeam,
): { readonly name: string; readonly seam: DimensionSeam } | undefined {
    if (argument === undefined || !ts.isIdentifier(argument)) {
        return undefined;
    }

    const enclosing = enclosingFunction(parsed, call);
    const name = enclosing === undefined ? undefined : parsed.names.get(enclosing.pos);

    if (enclosing === undefined || name === undefined) {
        return undefined;
    }

    const index = enclosing.parameters.findIndex(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === argument.text,
    );

    return index === -1 ? undefined : { name, seam: { argumentIndex: index, property: seam.property } };
}

/** A service's runtime sources — not tests, not CDK infra (an alarm's dimensions are W3/W4's question). */
function runtimeSources(service: DiscoveredService): readonly SourceFile[] {
    return service.sources.filter((source) => !isTestFile(source.file) && !isInfraFile(source.file));
}

/** Every EMF emitter in a service. */
export function serviceEmitters(service: DiscoveredService): readonly EmfEmitter[] {
    return runtimeSources(service).flatMap((source) => findEmfEmitters(source));
}

/**
 * Every named seam through which a caller can add a dimension key to one of this service's EMF metrics.
 *
 * Seeded from the emitters' own directives, then grown to a FIXPOINT across forwarding wrappers (see
 * {@link findMetricCalls}). The loop is bounded by the number of functions in the service and terminates as
 * soon as a pass adds nothing.
 *
 * @param service - The service to analyse.
 * @returns Emitter name → seam.
 */
export function dimensionSeams(service: DiscoveredService): ReadonlyMap<string, DimensionSeam> {
    const seams = new Map<string, DimensionSeam>();

    for (const emitter of serviceEmitters(service)) {
        if (emitter.name !== undefined && emitter.seam !== undefined) {
            seams.set(emitter.name, emitter.seam);
        }
    }

    for (let pass = 0; pass < 8; pass += 1) {
        const before = seams.size;

        for (const source of runtimeSources(service)) {
            for (const call of findMetricCalls(source, seams)) {
                if (call.forwards !== undefined && !seams.has(call.forwards.name)) {
                    seams.set(call.forwards.name, call.forwards.seam);
                }
            }
        }

        if (seams.size === before) {
            break;
        }
    }

    return seams;
}

/** Every call to a seam-bearing emitter in a service, read through the fixpoint seam map. */
function serviceCalls(service: DiscoveredService): readonly MetricCall[] {
    const seams = dimensionSeams(service);

    return runtimeSources(service).flatMap((source) => findMetricCalls(source, seams));
}

/**
 * How many emitter calls the gate actually read in a service — the per-service non-vacuity number.
 *
 * @param service - The service to analyse.
 * @returns The count of calls found at a resolved seam.
 */
export function serviceEmitterCallCount(service: DiscoveredService): number {
    return serviceCalls(service).length;
}

/**
 * Every dimension key a service publishes, from both extraction paths.
 *
 * @param service - The service to analyse.
 * @returns One entry per key occurrence, attributed to emitter or call site.
 */
export function serviceDimensionKeys(service: DiscoveredService): readonly DimensionKeySite[] {
    const fromEmitters = serviceEmitters(service).flatMap((emitter) =>
        emitter.literalKeys.map((key) => ({
            key,
            file: emitter.file,
            line: emitter.line,
            origin: 'emitter' as const,
        })),
    );

    const fromCalls = serviceCalls(service).flatMap((call) =>
        call.dimensionKeys.map((key) => ({
            key,
            file: call.file,
            line: call.line,
            origin: 'call-site' as const,
        })),
    );

    return [...fromEmitters, ...fromCalls];
}

// ───────────────────────────── the three findings ─────────────────────────────

/**
 * The rule itself: no dimension key outside {@link ALLOWED_DIMENSION_FACETS}.
 *
 * @param service - The service to check.
 * @returns One finding per offending key occurrence.
 */
export function identifierDimensionViolations(service: DiscoveredService): readonly string[] {
    return serviceDimensionKeys(service)
        .filter((site) => !isAllowedDimensionFacet(site.key))
        .map(
            (site) =>
                `${site.file}:${site.line} — '${site.key}' is a CloudWatch dimension (${site.origin}); every ` +
                'distinct value is a separately billed custom metric with 15-month retention. Move the value ' +
                'onto the adjacent scrubbed logger call, or add the key to ALLOWED_DIMENSION_FACETS with the ' +
                'reason its value space is bounded',
        );
}

/**
 * A dimension bag the gate cannot read is a finding, not a pass.
 *
 * @param service - The service to check.
 * @returns One finding per unreadable bag.
 */
export function unreadableDimensionViolations(service: DiscoveredService): readonly string[] {
    return serviceCalls(service)
        .filter((call) => call.unreadable)
        .map(
            (call) =>
                `${call.file}:${call.line} — the dimension bag passed to '${call.callee}' is not an inline ` +
                'object literal, so this gate cannot enumerate its keys. Inline it',
        );
}

/**
 * An emitter that takes caller-supplied dimension keys the gate cannot trace back to a parameter would make
 * every call-site check iterate zero times and pass forever.
 *
 * @param service - The service to check.
 * @returns One finding per untraceable open emitter.
 */
export function blindEmitterViolations(service: DiscoveredService): readonly string[] {
    return serviceEmitters(service)
        .filter((emitter) => emitter.open && (emitter.seam === undefined || emitter.name === undefined))
        .map(
            (emitter) =>
                `${emitter.file}:${emitter.line} — this EMF directive takes dimension keys from a runtime ` +
                'value the gate cannot trace to a named emitter parameter, so caller-supplied keys would go ' +
                'unchecked. List the keys as literals, or pass the bag through a plain named parameter',
        );
}

// ───────────────────────────── fixtures for the mutation directions ─────────────────────────────

/** Build a synthetic service so each predicate can be fired at a deliberately-violating tree. */
function fakeService(name: string, files: Readonly<Record<string, string>>): DiscoveredService {
    return {
        name,
        packageName: `@fake/${name}`,
        sources: Object.entries(files).map(([file, contents]) => ({
            file: `packages/services/${name}/${file}`,
            contents,
        })),
    };
}

/** `food-service`'s shape: the bag is nested in an options object and reaches `Dimensions` via two locals. */
const NESTED_BAG_EMITTER = `
interface EmfInput { readonly metrics: readonly string[]; readonly dimensions?: Record<string, string>; }
export function emitMetric(input: EmfInput, sink: (line: string) => void): void {
    const dimensions = input.dimensions ?? {};
    const dimensionKeys = Object.keys(dimensions);
    sink(JSON.stringify({
        _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'N', Dimensions: [dimensionKeys], Metrics: [] }] },
    }));
}
`;

/** `identity-webhooks`' shape: two literal keys plus a spread of a positional bag parameter. */
const POSITIONAL_BAG_EMITTER = `
export const emitMetric = (metricName: string, value: number, dimensions: Record<string, string> = {}): void => {
    process.stdout.write(JSON.stringify({
        _aws: {
            Timestamp: 0,
            CloudWatchMetrics: [{
                Namespace: 'N',
                Dimensions: [['service', 'metric', ...Object.keys(dimensions)]],
                Metrics: [{ Name: metricName, Unit: 'Count' }],
            }],
        },
        value,
    }));
};
`;

/** `recipe-workers`' shape: the dimension set is closed at the emitter, so callers cannot add keys. */
const closedEmitter = (key: string): string => `
export function emitMetric({ name, stage, value }: { name: string; stage: string; value: number }): void {
    console.log(JSON.stringify({
        _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'N', Dimensions: [['${key}']], Metrics: [{ Name: name }] }] },
        ${key}: stage,
        [name]: value,
    }));
}
`;

// ───────────────────────────── the rule, in both directions ─────────────────────────────

describe('the facet allowlist', () => {
    it.each(['userId', 'identityId', 'ownerId', 'requestId', 'sub', 'clerkSub', 'email'])(
        'rejects the identifier %s',
        (key) => {
            expect(isAllowedDimensionFacet(key)).toBe(false);
        },
    );

    it.each(['clerkUserKey', 'sessionToken', 'deviceFingerprint', 'ownerHandle', 'recipeSlug', 'query'])(
        'rejects %s, which no *id/*sub denylist would have caught',
        (key) => {
            expect(isAllowedDimensionFacet(key)).toBe(false);
        },
    );

    it.each(['service', 'metric', 'stage', 'Stage', 'source', 'reason'])('admits the bounded facet %s', (key) => {
        expect(isAllowedDimensionFacet(key)).toBe(true);
    });

    it('states a bound for every facet it admits', () => {
        expect([...ALLOWED_DIMENSION_FACETS].filter(([, why]) => why.length < 20)).toEqual([]);
    });
});

describe('an emitter that closes its own dimension set', () => {
    it('reports the identifier it hard-codes', () => {
        const findings = identifierDimensionViolations(
            fakeService('closed-bad', { 'src/metrics.ts': closedEmitter('identityId') }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain("'identityId' is a CloudWatch dimension (emitter)");
    });

    it('stays green on a bounded facet', () => {
        const service = fakeService('closed-good', { 'src/metrics.ts': closedEmitter('Stage') });

        expect(identifierDimensionViolations(service)).toEqual([]);
        expect(blindEmitterViolations(service)).toEqual([]);
    });

    it('does not scan call sites, because callers cannot add a key to a closed set', () => {
        const service = fakeService('closed-callers', {
            'src/metrics.ts': closedEmitter('Stage'),
            'src/handler.ts': "emitMetric({ name: 'M', stage: 'prod', value: 1 });",
        });

        expect(identifierDimensionViolations(service)).toEqual([]);
    });
});

describe('an emitter whose keys come from callers', () => {
    it('reads a bag nested in an options object, through two local hops', () => {
        const service = fakeService('nested-good', {
            'src/emf.ts': NESTED_BAG_EMITTER,
            'src/worker.ts': 'emitMetric({ metrics: [], dimensions: { source } }, sink);',
        });

        expect(serviceDimensionKeys(service).map((site) => site.key)).toEqual(['source']);
        expect(identifierDimensionViolations(service)).toEqual([]);
    });

    it('reports an identifier passed through the nested bag', () => {
        const findings = identifierDimensionViolations(
            fakeService('nested-bad', {
                'src/emf.ts': NESTED_BAG_EMITTER,
                'src/worker.ts': 'emitMetric({ metrics: [], dimensions: { userId } }, sink);',
            }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain("'userId' is a CloudWatch dimension (call-site)");
    });

    it('reads a positional bag and keeps the literal keys the emitter adds itself', () => {
        const service = fakeService('positional-good', {
            'src/emf.ts': POSITIONAL_BAG_EMITTER,
            'src/handler.ts': "emitMetric('M', 1, { reason });\nemitMetric('N', 1);",
        });

        expect([...new Set(serviceDimensionKeys(service).map((site) => site.key))].sort()).toEqual([
            'metric',
            'reason',
            'service',
        ]);
        expect(identifierDimensionViolations(service)).toEqual([]);
    });

    /**
     * Pinning a regression the real tree found: `food-service`'s `buildEmf` normalises its bag with
     * `Object.entries(input.dimensions ?? {}).filter(…)`, so the bag travels through the `.filter` RECEIVER
     * while argument 0 is a callback. Following argument 0 only made a correct emitter report as blind.
     */
    it('traces a bag through a method-call receiver, not just through argument 0', () => {
        const service = fakeService('receiver-route', {
            'src/emf.ts': `
interface EmfInput { readonly dimensions?: Record<string, string>; }
export function emitMetric(input: EmfInput): void {
    const entries = Object.entries(input.dimensions ?? {}).filter(([, value]) => value !== undefined);
    const dimensionKeys = Object.keys(Object.fromEntries(entries));
    console.log(JSON.stringify({
        _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'N', Dimensions: [dimensionKeys], Metrics: [] }] },
    }));
}
`,
            'src/worker.ts': 'emitMetric({ dimensions: { source } });',
        });

        expect(blindEmitterViolations(service)).toEqual([]);
        expect(serviceDimensionKeys(service).map((site) => site.key)).toEqual(['source']);
    });

    it('reports an identifier passed positionally', () => {
        const findings = identifierDimensionViolations(
            fakeService('positional-bad', {
                'src/emf.ts': POSITIONAL_BAG_EMITTER,
                'src/handler.ts': "emitMetric('M', 1, { identityId });",
            }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain("'identityId' is a CloudWatch dimension (call-site)");
    });
});

describe('the ways this gate could go blind', () => {
    it('reports a bag it cannot enumerate rather than reading zero keys from it', () => {
        const service = fakeService('opaque', {
            'src/emf.ts': POSITIONAL_BAG_EMITTER,
            'src/handler.ts': "const dims = { userId };\nemitMetric('M', 1, dims);",
        });

        expect(unreadableDimensionViolations(service)).toHaveLength(1);
        expect(unreadableDimensionViolations(service)[0]).toContain('not an inline object literal');
    });

    it('reports a spread inside an otherwise readable bag', () => {
        const service = fakeService('spread', {
            'src/emf.ts': POSITIONAL_BAG_EMITTER,
            'src/handler.ts': "emitMetric('M', 1, { reason, ...extra });",
        });

        expect(unreadableDimensionViolations(service)).toHaveLength(1);
    });

    it('reports an open emitter whose dimension source cannot be traced to a parameter', () => {
        const findings = blindEmitterViolations(
            fakeService('blind', {
                'src/emf.ts': `
const keys = (): string[] => ['whatever'];
export function emitMetric(value: number): void {
    console.log(JSON.stringify({
        _aws: { Timestamp: 0, CloudWatchMetrics: [{ Namespace: 'N', Dimensions: [keys()], Metrics: [] }] },
        value,
    }));
}
`,
            }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0]).toContain('cannot trace to a named emitter parameter');
    });

    it('parses rather than greps — a call in a comment or a string is not a call', () => {
        const service = fakeService('prose', {
            'src/emf.ts': POSITIONAL_BAG_EMITTER,
            'src/handler.ts': [
                "/** Never write emitMetric('M', 1, { identityId }) — see the cardinality gate. */",
                'export const doc = "emitMetric(\'M\', 1, { userId })";',
            ].join('\n'),
        });

        expect(identifierDimensionViolations(service)).toEqual([]);
        expect(unreadableDimensionViolations(service)).toEqual([]);
    });

    it('is not defeated by the emitter documenting the rule it enforces', () => {
        const service = fakeService('self-documenting', {
            'src/emf.ts': `/** Never pass userId, identityId, sub or email here. */\n${POSITIONAL_BAG_EMITTER}`,
            'src/handler.ts': "emitMetric('M', 1, { reason });",
        });

        expect(identifierDimensionViolations(service)).toEqual([]);
    });
});

// ───────────────────────────── the real tree ─────────────────────────────

const services = discoverServices();
const emitting = services.filter((service) => serviceEmitters(service).length > 0);
const keys = emitting.flatMap((service) => serviceDimensionKeys(service));

describe('every deployable service', () => {
    it('was discovered from its own manifest, not a list in this file', () => {
        expect(services.length).toBeGreaterThanOrEqual(5);
    });

    it('yielded EMF emitters in more than one service (non-vacuity)', () => {
        expect(emitting.length).toBeGreaterThanOrEqual(3);
        expect(emitting.flatMap((service) => serviceEmitters(service)).length).toBeGreaterThanOrEqual(4);
    });

    it('exercised BOTH extraction paths, so neither can have silently stopped working', () => {
        expect(keys.filter((site) => site.origin === 'emitter').length).toBeGreaterThanOrEqual(1);
        expect(keys.filter((site) => site.origin === 'call-site').length).toBeGreaterThanOrEqual(1);
    });

    // The per-service half of non-vacuity, and the one the retired identity-local guard asserted directly
    // (`expect(metricCalls.length).toBeGreaterThanOrEqual(10)`): a service whose emitter takes caller-supplied
    // keys must have had its callers READ. Zero calls found there means the seam resolved to something nothing
    // matches — a clean-looking pass over an unexamined service.
    it('read the callers of every emitter that lets callers add keys', () => {
        const unexamined = emitting
            .filter((service) => dimensionSeams(service).size > 0)
            .filter((service) => serviceEmitterCallCount(service) === 0)
            .map(
                (service) =>
                    `${service.name}: an emitter takes caller-supplied dimension keys, but no call sites were read`,
            );

        expect(unexamined).toEqual([]);
        expect(emitting.filter((service) => dimensionSeams(service).size > 0).length).toBeGreaterThanOrEqual(2);
    });

    // ⛔ If this fails, do NOT delete the information — move the identifier onto the adjacent scrubbed
    // `logger.*` call, where it is searchable per user AND pseudonymised. Read this module's docstring for
    // the arithmetic and for why an unbilled EMF property is the wrong home.
    it('carries no identifier as a CloudWatch dimension', () => {
        expect(emitting.flatMap((service) => identifierDimensionViolations(service))).toEqual([]);
    });

    it('passes every dimension bag as an inline object literal', () => {
        expect(emitting.flatMap((service) => unreadableDimensionViolations(service))).toEqual([]);
    });

    it('exposes no EMF emitter whose caller-supplied keys this gate cannot see', () => {
        expect(emitting.flatMap((service) => blindEmitterViolations(service))).toEqual([]);
    });
});
