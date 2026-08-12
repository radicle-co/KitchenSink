/**
 * THE CONSUMER HALF of `docs/CODING_STANDARDS.md` §15 / ADR-0014, expressed as code a build can run.
 *
 * §15 has two halves. The service half — "zod is authored in the service and copied to
 * `packages/schemas/<service>`" — is already guarded: `contract-drift-gate`, `generated-schema-packages`
 * and the boot-time `CONTRACT_HASH` assertion all watch it. The CONSUMER half — "every client imports its
 * wire types and zod from that package, declares none of its own, and PARSES what the server sends" — was
 * guarded by nothing, which is how the 276 + 144 lines of hand-written client types §15.1 measures came to
 * exist behind green builds in the first place.
 *
 * ⚠️ THIS MODULE IS THE RULE, NOT A REPORT. A one-time cleanup of today's three clients does not satisfy
 * the requirement, because the requirement is about the client someone adds next month. So every rule below
 * runs against a DISCOVERED set of packages (`packages/clients/*` plus every manifest under
 * `packages/apps/`), never an enumerated one, and the third-party exception is an explicit **opt-out marker
 * inside the package** rather than a name allowlist — `packages/clients/stripe` must state its own case,
 * and cannot inherit `packages/clients/usda`'s.
 *
 * ── WHY THE ANALYSIS IS AN AST WALK AND NOT A GREP ──
 *
 * The first attempt at rule {@link RULE_UNVALIDATED_RESPONSE_BODY} was `grep -c '\.(parse|safeParse)\('`,
 * which also matches `Date.parse(` and `JSON.parse(` — so it reported response validation in files that had
 * none, and the reported "coverage" was an artifact of the tool. Every predicate here is therefore
 * structural: {@link isContractParse} matches a call to `.parse`/`.safeParse` whose RECEIVER is neither
 * `JSON` nor `Date`, and {@link readsResponseBody} matches a `.json()` call, a `JSON.parse(…)`, or a
 * `.body`/`.payload` access on a receiver named like a response. `typescript` is already a dependency of
 * this package; hand-rolling a TypeScript parser to answer these questions would be the reinvention the
 * library-first gate forbids.
 *
 * ── PURE / IMPURE SPLIT, AND WHY IT MATTERS HERE ──
 *
 * {@link auditConsumerPackage} and {@link collectPublishedContractNames} are PURE: they take source text and
 * return findings. {@link discoverConsumerPackages} and {@link readPublishedContractNames} do the IO. That
 * split is what lets the suite prove each rule fires by feeding it a FIXTURE package that violates exactly
 * one of them — a gate nobody has watched go red is a gate nobody knows works. Same shape as
 * `.github/scripts/deploy-gate.sh`'s pure `decide` + impure `evaluate`.
 *
 * ── HONEST LIMITS, recorded so nobody reads this as a proof ──
 *
 *  - `declares-wire-shape` fires on a name that COLLIDES with a published contract export, or that carries
 *    a wire-envelope SUFFIX (`…Request`, `…Response`, `…Dto`, …). A hand-written twin named `RecipeBits`
 *    slips through. It is a ratchet against the naming this repo actually uses, not a semantic diff.
 *  - `unvalidated-response-body` is function-scoped: it fires when a function reads a response body, casts
 *    something, and never runs a contract parse. A function that parses one body and casts a second is not
 *    caught. Both limits are why the rules complement — and do not replace — the per-client behavioural
 *    tests that post a wrong-shaped body and assert the call rejects.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** One source file's path (repo-relative, for messages) and its text. */
export interface ConsumerSource {
    readonly path: string;
    readonly text: string;
}

/** The opt-out marker a third-party client places in its own `package.json`. */
export interface WireContractMarker {
    /** `true` to declare this package a third-party boundary (§15.3) rather than a consumer of our own API. */
    readonly thirdParty?: boolean;
    /** Why. Required, and required to be substantive — an exemption with no stated case is a hole. */
    readonly reason?: string;
}

/** The subset of a `package.json` these rules read. */
export interface ConsumerManifest {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly kitchensink?: { readonly wireContract?: WireContractMarker };
}

/** A discovered consumer package: its manifest, its sources, and where it sits. */
export interface ConsumerPackage {
    /** Repo-relative directory, e.g. `packages/clients/food-service`. */
    readonly dir: string;
    /** `client` for `packages/clients/*` (a client by location), `app` for anything under `packages/apps/`. */
    readonly kind: 'client' | 'app';
    readonly manifest: ConsumerManifest;
    readonly sources: readonly ConsumerSource[];
}

/** One rule violation, addressed precisely enough to fix without re-deriving the rule. */
export interface Violation {
    readonly rule: string;
    readonly package: string;
    readonly file?: string;
    readonly line?: number;
    readonly symbol?: string;
    readonly detail: string;
}

/** A third-party exemption was claimed without a substantive reason. */
export const RULE_EXEMPTION_NEEDS_REASON = 'third-party-exemption-needs-reason';

/** A third-party exemption was claimed by a package that cannot validate at all (no `zod`). */
export const RULE_EXEMPTION_NEEDS_ZOD = 'third-party-exemption-needs-own-validation';

/** A package that speaks HTTP to one of OUR services declares no `@kitchensink/schema-*` dependency. */
export const RULE_MISSING_SCHEMA_DEPENDENCY = 'missing-schema-dependency';

/** The schema package is imported for TYPES only — so the consumer has a contract but no validator. */
export const RULE_SCHEMA_TYPES_ONLY = 'schema-package-imported-types-only';

/** A wire request/response shape is DECLARED here instead of imported or derived from the contract. */
export const RULE_DECLARES_WIRE_SHAPE = 'declares-wire-shape';

/** A response body is read and cast without ever being parsed against the published contract. */
export const RULE_UNVALIDATED_RESPONSE_BODY = 'unvalidated-response-body';

/**
 * Suffixes that name a wire envelope in this repo. `Payload` is included because the identity error
 * envelope was re-declared under exactly that name inside an app feature package.
 */
const WIRE_NAME_SUFFIX = /(?:Request|Response|RequestBody|ResponseBody|Dto|Payload|Envelope)$/;

/** Receivers whose `.body` / `.payload` is a RESPONSE body rather than an object literal's field. */
const RESPONSE_RECEIVER = /^(?:res|response|raw|rawResponse|reply|httpResponse)$/;

/**
 * A declaration whose wire-ish NAME is not one of our services' wire shapes may say so with this tag plus a
 * substantive reason. It silences {@link RULE_DECLARES_WIRE_SHAPE} for that declaration only — never the
 * validation rule, which no naming argument can answer.
 */
const TAG_NOT_WIRE_SHAPE = '@notWireShape';

/**
 * A boundary that deliberately does NOT parse against a published contract may say so with this tag plus a
 * substantive reason. It is honoured on a FUNCTION (or the file, for a whole module) and silences
 * {@link RULE_UNVALIDATED_RESPONSE_BODY} there only.
 *
 * ⚠️ ONE tag, not one per situation, because the situations differ only in their REASON and that is where a
 * human reads them. The two legitimate reasons today:
 *
 *  - **§15.3, an API we do not serve** — Vercel, Route 53, Clerk, a CloudFront Function event. Permanent by
 *    design: there is no service of ours to publish the shape.
 *  - **Our service publishes no schema for this shape YET** — the recipe service authors no
 *    `api-error.schema.ts`, while food and identity both do, so its error envelope has no published zod to
 *    parse against. That is DEBT, and the reason text must name the service-side follow-up so it stays
 *    visible and greppable instead of becoming a silent cast again.
 *
 * The tag never silences {@link RULE_DECLARES_WIRE_SHAPE}: not parsing a shape is not a licence to re-declare
 * one that IS published.
 */
const TAG_UNPARSED_BOUNDARY = '@unparsedBoundary';

/** A marker tag counts only when it carries a real justification, not just the tag. */
const MIN_REASON_LENGTH = 20;

/** Minimum length for the manifest-level exemption reason. Same principle, different location. */
const MIN_MANIFEST_REASON_LENGTH = 40;

/** Parse `text` as a TypeScript source file with position info (needed for line numbers). */
function parseSource(source: ConsumerSource): ts.SourceFile {
    return ts.createSourceFile(
        source.path,
        source.text,
        ts.ScriptTarget.ESNext,
        true,
        source.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

/** 1-based line of `node` within `sourceFile`. */
function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Every descendant of `node` (inclusive) satisfying `predicate`. */
function collect(node: ts.Node, predicate: (candidate: ts.Node) => boolean): ts.Node[] {
    const hits: ts.Node[] = [];
    const visit = (candidate: ts.Node): void => {
        if (predicate(candidate)) {
            hits.push(candidate);
        }
        ts.forEachChild(candidate, visit);
    };

    visit(node);

    return hits;
}

/**
 * True for a call to `.parse(…)` / `.safeParse(…)` whose receiver is NEITHER `JSON` nor `Date`.
 *
 * ⚠️ The receiver exclusion is the whole point. A textual search for `.parse(` reports `Date.parse(…)` and
 * `JSON.parse(…)` as contract validation, which is how an earlier audit of this exact rule claimed response
 * validation existed in a client that cast every body — a measurement that was an artifact of the tool.
 */
export function isContractParse(node: ts.Node, sourceFile: ts.SourceFile): boolean {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
        return false;
    }

    const method = node.expression.name.text;

    if (method !== 'parse' && method !== 'safeParse') {
        return false;
    }

    const receiver = node.expression.expression.getText(sourceFile);

    return receiver !== 'JSON' && receiver !== 'Date';
}

/** True for an expression that READS an HTTP response body: `x.json()`, `JSON.parse(…)`, `res.body`. */
function readsResponseBody(node: ts.Node, sourceFile: ts.SourceFile): boolean {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === 'json') {
            return true;
        }

        if (node.expression.name.text === 'parse' && node.expression.expression.getText(sourceFile) === 'JSON') {
            return true;
        }
    }

    // `.body` / `.payload`, but ONLY on a response-shaped receiver: a design-token module full of
    // `lineHeightRatio.body` is not reading an HTTP response, and an earlier draft of this rule flagged it.
    return (
        ts.isPropertyAccessExpression(node) &&
        (node.name.text === 'body' || node.name.text === 'payload') &&
        RESPONSE_RECEIVER.test(node.expression.getText(sourceFile))
    );
}

/** True for a type assertion that ESTABLISHES a shape — `as unknown` and `as const` widen/narrow nothing. */
function isShapeAssertion(node: ts.Node): boolean {
    if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) {
        return false;
    }

    if (node.type.kind === ts.SyntaxKind.UnknownKeyword) {
        return false;
    }

    return !(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === 'const');
}

/** True when the JSDoc/comment text immediately preceding `node` carries `tag` plus a substantive reason. */
function hasJustifiedTag(sourceFile: ts.SourceFile, node: ts.Node, tag: string, minReason: number): boolean {
    const leading = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile));

    return carriesJustifiedTag(leading, tag, minReason);
}

/** True when `text` contains `tag` followed by at least `minReason` characters of justification. */
function carriesJustifiedTag(text: string, tag: string, minReason: number): boolean {
    const at = text.indexOf(tag);

    if (at === -1) {
        return false;
    }

    // Everything after the tag, with comment furniture stripped, is the reason.
    const reason = text
        .slice(at + tag.length)
        .replace(/[*/\s]+/g, ' ')
        .trim();

    return reason.length >= minReason;
}

/** True when a whole FILE declares itself a deliberately-unparsed boundary with a substantive reason. */
export function isUnparsedBoundaryFile(source: ConsumerSource): boolean {
    return carriesJustifiedTag(source.text, TAG_UNPARSED_BOUNDARY, MIN_REASON_LENGTH);
}

/** True when a package's own manifest claims the §15.3 third-party exemption. */
export function claimsThirdPartyExemption(manifest: ConsumerManifest): boolean {
    return manifest.kitchensink?.wireContract?.thirdParty === true;
}

/** Every dependency name a manifest declares, across every section that creates an edge. */
function dependencyNames(manifest: ConsumerManifest): readonly string[] {
    return [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
    ];
}

/** The `@kitchensink/schema-*` packages this manifest declares a dependency on. */
export function declaredSchemaPackages(manifest: ConsumerManifest): readonly string[] {
    return dependencyNames(manifest)
        .filter((name) => name.startsWith('@kitchensink/schema-'))
        .sort();
}

/** Whether an import/export declaration is type-only (`import type …` / `export type …`). */
function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
    if (ts.isImportDeclaration(node)) {
        return node.importClause?.isTypeOnly === true;
    }

    return node.isTypeOnly;
}

/** Named bindings of a specifier clause, with per-binding `type` modifiers accounted for. */
function valueImportCount(node: ts.ImportDeclaration): number {
    const clause = node.importClause;

    if (clause === undefined || clause.isTypeOnly) {
        return 0;
    }

    if (clause.name !== undefined) {
        return 1;
    }

    if (clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
        // A namespace import (`import * as x`) is a value import.
        return 1;
    }

    return clause.namedBindings.elements.filter((element) => !element.isTypeOnly).length;
}

/**
 * How this package reaches a `@kitchensink/schema-*` package in SOURCE: whether it imports at all, and
 * whether any of those imports brings in a RUNTIME value (a zod schema) rather than only a type.
 *
 * The distinction is the difference between "has the contract's shape" and "can check the contract at
 * runtime". A client with only `import type` satisfies §15's rule 4 for types and none of ADR-0014's
 * response-parsing obligation, and that is exactly the state `ProfileServiceClient` shipped in.
 */
export function schemaImportUsage(pkg: ConsumerPackage): { readonly imports: boolean; readonly values: boolean } {
    let imports = false;
    let values = false;

    for (const source of pkg.sources) {
        const sourceFile = parseSource(source);

        ts.forEachChild(sourceFile, (node) => {
            const specifier =
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier !== undefined &&
                ts.isStringLiteral(node.moduleSpecifier)
                    ? node.moduleSpecifier.text
                    : undefined;

            if (specifier === undefined || !specifier.startsWith('@kitchensink/schema-')) {
                return;
            }

            imports = true;

            if (ts.isImportDeclaration(node) && !isTypeOnly(node) && valueImportCount(node) > 0) {
                values = true;
            }
        });
    }

    return { imports, values };
}

/**
 * True when this package issues HTTP requests at one of OUR versioned service paths.
 *
 * A `packages/clients/*` package is a client by LOCATION and never needs this test; it exists for the app
 * layer, where a package may hand-roll a transport instead of using a client (`ProfileServiceClient` in
 * `@commise/features-account`, `apiClient` in `@commise/web`, `apiRequest` in `@commise/mobile` all did).
 * Such a package is held to the client rules, because it IS one.
 */
export function speaksToOurServices(pkg: ConsumerPackage): boolean {
    // PACKAGE-scoped, not file-scoped, and that is the whole subtlety. `@commise/web`'s `apiClient.ts` calls
    // `fetch` with a caller-supplied `endpoint`, so the `/api/v1/users/me` literal lives in `ProfileContent.tsx`
    // — a different file. Requiring both signals in ONE file exempted the very transport this rule exists to
    // catch. A package that both issues requests AND names one of our versioned paths is a client.
    const issuesRequests = pkg.sources.some((source) =>
        /\bfetch\s*\(|\bfetchImpl\s*\(|from 'ky'|require\('ky'\)/.test(source.text),
    );
    const namesOurPaths = pkg.sources.some((source) => /['"`]\/api\/v\d+\//.test(source.text));

    return issuesRequests && namesOurPaths;
}

/** Rule {@link RULE_DECLARES_WIRE_SHAPE}: fresh wire-shape declarations in one file. */
function auditDeclarations(
    pkg: ConsumerPackage,
    source: ConsumerSource,
    publishedNames: ReadonlySet<string>,
): Violation[] {
    const sourceFile = parseSource(source);
    const violations: Violation[] = [];

    const isFreshDeclaration = (node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): boolean =>
        ts.isInterfaceDeclaration(node)
            ? // `extends SomeContractType` is a derivation; a standalone member list is a second declaration.
              node.heritageClauses === undefined
            : // `type X = { … }` declares; `type X = Pick<…>` / `X['y']` / an alias derives.
              ts.isTypeLiteralNode(node.type);

    for (const node of collect(
        sourceFile,
        (candidate) => ts.isInterfaceDeclaration(candidate) || ts.isTypeAliasDeclaration(candidate),
    )) {
        const declaration = node as ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
        const name = declaration.name.text;
        const collides = publishedNames.has(name);
        const wireNamed = WIRE_NAME_SUFFIX.test(name);

        if ((!collides && !wireNamed) || !isFreshDeclaration(declaration)) {
            continue;
        }

        if (hasJustifiedTag(sourceFile, declaration, TAG_NOT_WIRE_SHAPE, MIN_REASON_LENGTH)) {
            continue;
        }

        violations.push({
            rule: RULE_DECLARES_WIRE_SHAPE,
            package: pkg.dir,
            file: source.path,
            line: lineOf(sourceFile, declaration),
            symbol: name,
            detail: collides
                ? `\`${name}\` is ALSO exported by a packages/schemas/* contract — import or derive it, never re-declare it (§15 rule 4)`
                : `\`${name}\` is declared fresh under a wire-envelope name — import it from @kitchensink/schema-*, derive it with Pick/Omit/Partial, or tag the declaration \`${TAG_NOT_WIRE_SHAPE} <reason>\` if it is genuinely client-side`,
        });
    }

    return violations;
}

/** Rule {@link RULE_UNVALIDATED_RESPONSE_BODY}: functions that read a body, cast it, and never parse. */
function auditResponseValidation(pkg: ConsumerPackage, source: ConsumerSource): Violation[] {
    const sourceFile = parseSource(source);
    const violations: Violation[] = [];

    const functions = collect(
        sourceFile,
        (candidate) =>
            ts.isFunctionDeclaration(candidate) ||
            ts.isMethodDeclaration(candidate) ||
            ts.isArrowFunction(candidate) ||
            ts.isFunctionExpression(candidate),
    ) as readonly ts.SignatureDeclaration[];

    for (const fn of functions) {
        const body = (fn as { body?: ts.Node }).body;

        if (body === undefined) {
            continue;
        }

        if (collect(body, (candidate) => readsResponseBody(candidate, sourceFile)).length === 0) {
            continue;
        }

        const casts = collect(body, isShapeAssertion);

        if (casts.length === 0) {
            continue;
        }

        if (collect(body, (candidate) => isContractParse(candidate, sourceFile)).length > 0) {
            continue;
        }

        // A per-FUNCTION opt-out, for the module that holds both a contract-backed boundary and one that has
        // no published schema to parse against. The reason is mandatory and is the whole value of the tag.
        if (hasJustifiedTag(sourceFile, fn, TAG_UNPARSED_BOUNDARY, MIN_REASON_LENGTH)) {
            continue;
        }

        const name = (fn as { name?: ts.Node }).name?.getText(sourceFile) ?? '<anonymous>';

        violations.push({
            rule: RULE_UNVALIDATED_RESPONSE_BODY,
            package: pkg.dir,
            file: source.path,
            line: lineOf(sourceFile, fn),
            symbol: name,
            detail: `\`${name}\` reads a response body and asserts its shape with \`as\` without ever parsing it against the published contract — a cast makes the client's beliefs about the server unfalsifiable (ADR-0014). Parse with the schema package's zod, or tag the function \`${TAG_UNPARSED_BOUNDARY} <reason>\` when there is genuinely no published schema to parse against (§15.3 third party, or a shape our own service does not publish yet).`,
        });
    }

    return violations;
}

/**
 * Audit ONE consumer package against every consumer-half rule of §15 / ADR-0014.
 *
 * @param pkg - The discovered package: manifest plus source text.
 * @param publishedNames - Every symbol name exported by any `packages/schemas/*` contract.
 * @returns Every violation found, addressed by file, line and symbol. Empty means compliant.
 */
export function auditConsumerPackage(pkg: ConsumerPackage, publishedNames: ReadonlySet<string>): readonly Violation[] {
    const violations: Violation[] = [];
    const name = pkg.manifest.name ?? pkg.dir;

    // ── The third-party exemption (§15.3). An opt-out MARKER in the package, never a name allowlist: a
    // future `packages/clients/stripe` states its own case, and cannot inherit `usda`'s by sitting beside it.
    if (claimsThirdPartyExemption(pkg.manifest)) {
        const reason = pkg.manifest.kitchensink?.wireContract?.reason ?? '';

        if (reason.trim().length < MIN_MANIFEST_REASON_LENGTH) {
            violations.push({
                rule: RULE_EXEMPTION_NEEDS_REASON,
                package: pkg.dir,
                detail: `${name} claims the §15.3 third-party exemption with no substantive \`kitchensink.wireContract.reason\` — an exemption whose case is not written down is indistinguishable from an oversight`,
            });
        }

        // The exemption moves WHERE the contract comes from; it never removes the boundary check. §15.3's
        // reference implementation (`packages/clients/usda`) validates the raw upstream shape with its OWN
        // zod, and applying the exemption without that is how "we do not own this type" becomes "we trust
        // this JSON".
        if (!dependencyNames(pkg.manifest).includes('zod')) {
            violations.push({
                rule: RULE_EXEMPTION_NEEDS_ZOD,
                package: pkg.dir,
                detail: `${name} is exempt from importing a schema package but declares no \`zod\` — a third-party boundary must still validate the raw upstream shape with its own runtime schema (§15.3), or the exemption deletes a validation boundary instead of relocating it`,
            });
        }

        return violations;
    }

    const speaksHttp = pkg.kind === 'client' || speaksToOurServices(pkg);

    if (speaksHttp) {
        const usage = schemaImportUsage(pkg);

        if (declaredSchemaPackages(pkg.manifest).length === 0) {
            violations.push({
                rule: RULE_MISSING_SCHEMA_DEPENDENCY,
                package: pkg.dir,
                detail: `${name} speaks HTTP to one of our services but declares no @kitchensink/schema-* dependency — its wire types and zod must come from the contract the service publishes (§15 rule 4). If it targets an API we do not serve, mark it \`kitchensink.wireContract.thirdParty\` with a reason (§15.3).`,
            });
        } else if (pkg.kind === 'client' && usage.imports && !usage.values) {
            // ⚠️ CLIENTS ONLY, and the restriction is the point rather than a softening.
            //
            // A `packages/clients/*` package IS the validation boundary: types with no runtime zod means it has
            // the contract's shape and no way to check it, which is exactly the state `ProfileServiceClient`
            // shipped in (three `import type` names and `JSON.parse(text) as T`).
            //
            // An APP is different. `@commise/web` imports `@kitchensink/schema-identity` type-only and needs no
            // validator of its own, because every identity read it makes goes through `ProfileServiceClient`,
            // which parses. Firing here would push an app toward re-validating what its client already
            // validated — a second parse of one contract, which is the duplication §15 forbids wearing a
            // different hat. For an app, the operative check is {@link RULE_UNVALIDATED_RESPONSE_BODY}: it fires
            // precisely when the app reads a body ITSELF and asserts its shape.
            //
            // The residual gap, stated rather than hidden: an app that hand-rolls a transport, imports types
            // only, and returns `unknown` without casting satisfies both rules. It is also the one shape of
            // hand-rolled transport that is not lying to its caller, so it is not worth more machinery.
            violations.push({
                rule: RULE_SCHEMA_TYPES_ONLY,
                package: pkg.dir,
                detail: `${name} imports its schema package for TYPES ONLY, so it has the contract's shape and no way to check it at runtime. Import the zod values too and parse what the server sends (ADR-0014).`,
            });
        }
    }

    for (const source of pkg.sources) {
        // The declaration rule applies to EVERY file: not parsing a shape is never a licence to re-declare
        // one the contract already publishes.
        violations.push(...auditDeclarations(pkg, source, publishedNames));

        if (speaksHttp && !isUnparsedBoundaryFile(source)) {
            violations.push(...auditResponseValidation(pkg, source));
        }
    }

    return violations;
}

/**
 * Every symbol name exported by the generated contracts — the vocabulary a consumer must not re-declare.
 *
 * @param sources - Every `packages/schemas/*` source file.
 * @returns The exported type, interface and const names, deduplicated.
 */
export function collectPublishedContractNames(sources: readonly ConsumerSource[]): ReadonlySet<string> {
    const names = new Set<string>();

    for (const source of sources) {
        const sourceFile = parseSource(source);

        ts.forEachChild(sourceFile, (node) => {
            const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];

            if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
                return;
            }

            if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
                names.add(node.name.text);
            }

            if (ts.isVariableStatement(node)) {
                for (const declaration of node.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name)) {
                        names.add(declaration.name.text);
                    }
                }
            }
        });
    }

    return names;
}

/** Extensions worth parsing. `.d.ts` is generator output and is excluded with `dist/` below. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Paths that are tests, fixtures or build output — none of them is the package's shipped contract surface.
 *
 * Every test TIER is here, not just `__tests__`: the integration tier lives in `__integration__`, and a
 * `*.test.ts` / `*.spec.ts` may sit beside the code it covers. A test double is ALLOWED to declare a
 * wire-ish shape (`CannedResponse`, `ReceivedRequest` in the recipe client's integration harness describe the
 * DOUBLE, not the service), and a `dist/*.d.ts` is a copy whose violations would otherwise be counted twice.
 */
const NON_PRODUCTION =
    /(?:^|\/)(?:dist|node_modules|\.next|\.turbo|__tests__|__integration__|__fixtures__|__mocks__|tests|test|coverage)(?:\/|$)|\.(?:test|spec)\.tsx?$/;

/**
 * Every file `git` tracks, repo-relative.
 *
 * `git ls-files` rather than a directory walk, for the reason `app-service-dependency.test.ts` records: a
 * walk picks up `.next/`, `dist/` and `cdk.out/`, and a `.d.ts` in `dist/` is a copy of a source file whose
 * violations would then be counted twice.
 *
 * @sideEffect Spawns `git`.
 */
function trackedFiles(repoRoot: string): readonly string[] {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n')
        .filter((line) => line.length > 0);
}

/**
 * Read every consumer package: `packages/clients/*` (clients by location) plus every manifest under
 * `packages/apps/` (web, mobile, ui, i18n and each `features/*`).
 *
 * DISCOVERED, never enumerated — a client or feature package added tomorrow is covered the day it lands.
 *
 * @param repoRoot - Absolute repo root.
 * @returns Each package with its manifest and production sources.
 * @sideEffect Reads from disk and spawns `git`.
 */
export function discoverConsumerPackages(repoRoot: string): readonly ConsumerPackage[] {
    const tracked = trackedFiles(repoRoot);
    const manifests = tracked.filter(
        (file) =>
            path.basename(file) === 'package.json' &&
            !NON_PRODUCTION.test(path.dirname(file)) &&
            (/^packages\/clients\/[^/]+\/package\.json$/.test(file) || file.startsWith('packages/apps/')),
    );

    return manifests
        .map((manifestPath) => {
            const dir = path.dirname(manifestPath);
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as ConsumerManifest;
            const sources = tracked
                .filter(
                    (file) =>
                        file.startsWith(`${dir}/`) &&
                        SOURCE_EXTENSIONS.includes(path.extname(file)) &&
                        !file.endsWith('.d.ts') &&
                        !NON_PRODUCTION.test(file) &&
                        // A nested package owns its own files (`packages/apps/commise/web/router`).
                        !manifests.some(
                            (other) => other !== manifestPath && file.startsWith(`${path.dirname(other)}/`),
                        ),
                )
                .map((file) => ({ path: file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));

            return {
                dir,
                kind: dir.startsWith('packages/clients/') ? ('client' as const) : ('app' as const),
                manifest,
                sources,
            };
        })
        .filter((pkg) => pkg.sources.length > 0);
}

/**
 * Every name the generated contracts publish, read from `packages/schemas/*`.
 *
 * @param repoRoot - Absolute repo root.
 * @returns The published vocabulary.
 * @sideEffect Reads from disk and spawns `git`.
 */
export function readPublishedContractNames(repoRoot: string): ReadonlySet<string> {
    const schemasRoot = path.join(repoRoot, 'packages/schemas');

    if (!existsSync(schemasRoot)) {
        return new Set<string>();
    }

    const sources = trackedFiles(repoRoot)
        .filter(
            (file) =>
                file.startsWith('packages/schemas/') &&
                file.endsWith('.ts') &&
                !file.endsWith('.d.ts') &&
                !NON_PRODUCTION.test(file),
        )
        .map((file) => ({ path: file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));

    return collectPublishedContractNames(sources);
}

/** Render violations as a stable, greppable report — one line each, sorted. */
export function formatViolations(violations: readonly Violation[]): string {
    return violations
        .map((violation) => {
            const at = violation.file === undefined ? violation.package : `${violation.file}:${violation.line ?? 0}`;

            return `[${violation.rule}] ${at}${violation.symbol === undefined ? '' : ` (${violation.symbol})`} — ${violation.detail}`;
        })
        .sort((left, right) => left.localeCompare(right))
        .join('\n');
}
