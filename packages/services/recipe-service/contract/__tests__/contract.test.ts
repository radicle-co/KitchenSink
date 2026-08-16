/**
 * THE DRIFT GATES for `@kitchensink/schema-recipe`, run as tests rather than as a bespoke CI step so they
 * execute on every `npm test` and in every existing CI job, with no workflow change to forget.
 *
 * Recipe was the ONE service of the three with no such suite. It had `openapi.test.ts` — the route-parity and
 * coverage ratchet — which guards the DOCUMENT, and nothing at all guarding the generated PACKAGE. So a
 * hand-edited `packages/schemas/recipe/src/schemas/*.ts`, a `CONTRACT_HASH` stamped on only one side, or a
 * runtime dependency added to the leaf would all have shipped green, while food and identity caught every one.
 *
 * `docs/CODING_STANDARDS.md` §15.2.5 names three layers, each catching what the others cannot:
 *
 *  - **Rebuild (turbo)** — declared in `turbo.json`; content-hashing this package's `build` over the service's
 *    authored `*.schema.ts`. Not testable from here.
 *  - **Correctness (this file)** — regenerate and fail on any difference from the committed artifacts. This is
 *    the STRONG gate: it is what catches generated output somebody hand-edited.
 *  - **Skew (this file)** — `CONTRACT_HASH` must be the fingerprint of the authored sources AND identical on
 *    both sides, or the boot-time skew assertion compares a value with itself and can never fail.
 *
 * WHY IT COMPARES INSTEAD OF SHELLING OUT TO THE GENERATOR. Running the real generator here would WRITE into the
 * repository from a test: a genuinely-drifted checkout would come out of `npm test` silently REPAIRED, so the
 * gate would report success having erased its own evidence. Comparing the committed bytes against a fresh
 * in-memory derivation catches the same drift, changes nothing, and names the file that disagrees.
 *
 * ── AND THE FOURTH GATE, WHICH IS THIS SUITE'S OWN ──
 *
 * `describe('mutating request bodies reject unknown keys')` enforces GR-017 §17-c, and it DISCOVERS its subjects
 * from the document's own route table rather than from a list. GR-017 states outright that "a hardcoded list of
 * services in a conformance test is itself the defect", and the same reasoning reaches a list of request bodies:
 * a list is a thing to forget, so a new `POST` would be out of scope until someone remembered it. Every component
 * used as a request body on a mutating operation is in scope the day the operation is added.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
    collectComposedSources,
    computeContractHash,
    discoverAuthoredSchemas,
    findUnpublishedSiblingImports,
    findViolations,
    flattenSiblingImports,
} from '@kitchensink/contract-gen';
import type { AuthoredSchema, ComposedSource } from '@kitchensink/contract-gen';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
    ALLOWED_PACKAGE_IMPORTS,
    EXCLUDED_FILES,
    SCHEMA_PACKAGE_NAME,
    SCHEMA_PACKAGE_ROOT,
    SERVICE_PATH_PREFIX,
    SERVICE_ROOT,
    SERVICE_STAMP_PATH,
} from '../config.js';
import { buildRecipeOpenApiDocument, openApiComponents } from '../openapi.js';

/** The authored schemas, discovered once with the SAME config the generator runs with. */
const authored: AuthoredSchema[] = await discoverAuthoredSchemas(SERVICE_ROOT, { excludeFiles: EXCLUDED_FILES });

/**
 * The COMPOSED sources the authored schemas build their shapes from — for recipe, `@kitchensink/recipe-core`.
 *
 * ⚠️ REQUIRED, and this parameter is why. `CONTRACT_HASH` used to fingerprint only the AUTHORED files, so
 * changing `recipeDetailSchema` inside `recipe-core` altered the wire shape while the hash stood still — drift
 * layer 3 was blind to every entity body this API returns. Recipe is the service where that mattered, because it
 * is the only one whose import allowlist admits a composed package at all (food and identity are zod-only, so
 * their composed corpus is empty and their fingerprints are unchanged).
 *
 * Collected with the SAME call the generator makes, so the value asserted below is the value that is stamped.
 */
const composed: readonly ComposedSource[] = await collectComposedSources(authored, { serviceRoot: SERVICE_ROOT });

/** The built document, shared by every assertion so the derivation happens once. */
const built = buildRecipeOpenApiDocument();

/**
 * Read a committed file from the generated package.
 *
 * @param relativePath - Path relative to the schema package root.
 * @returns The file's text.
 * @sideEffect Reads the filesystem.
 */
async function readCommitted(relativePath: string): Promise<string> {
    return readFile(join(SCHEMA_PACKAGE_ROOT, relativePath), 'utf8');
}

describe('the authored recipe wire contract', () => {
    it('contains at least one schema, so the package cannot be silently empty', () => {
        expect(authored.length).toBeGreaterThan(0);
    });

    // THE load-bearing safety property. A single import of a DAL type, a drizzle schema or a Nest symbol either
    // breaks the copied package outright or drags `drizzle-orm`/`@nestjs/*`/`pg`/`aws-sdk` into every consumer.
    // The predicate itself is mutation-tested in `@kitchensink/contract-gen`; this asserts it holds for the REAL
    // authored files, with this service's REAL allowlist.
    it('imports nothing but zod, recipe-core, and flat sibling schema modules', () => {
        const violations = authored.flatMap((schema) =>
            findViolations(schema.servicePath, schema.source, ALLOWED_PACKAGE_IMPORTS),
        );

        expect(violations).toStrictEqual([]);
    });

    // The gap the allowlist alone does NOT close: a `./something.schema.js` import is shaped like a flat sibling
    // and so `findViolations` admits it, while an EXCLUDED or renamed sibling would not exist in the generated
    // package. Asserted against the REAL authored files.
    it('imports no sibling schema that the generated package will not contain', () => {
        const publishedModuleNames = authored.map((schema) => schema.moduleName);
        const unresolved = authored.flatMap((schema) =>
            findUnpublishedSiblingImports(schema.servicePath, schema.source, publishedModuleNames),
        );

        expect(unresolved).toStrictEqual([]);
    });

    /**
     * Widening the allowlist is the one edit that can quietly undo the property above, so it is PINNED.
     *
     * The second entry is what makes recipe's allowlist wider than food's, and the reason is recorded in
     * `config.ts`: `recipe-core` already OWNS the recipe domain schemas, so composing it is what keeps there
     * from being a second declaration of `Recipe`. It is admissible on the same test every entry must pass —
     * it is itself a leaf whose only runtime dependency is zod, asserted below rather than asserted about.
     */
    it('allows ONLY zod and recipe-core at the package level', () => {
        expect(ALLOWED_PACKAGE_IMPORTS.map((entry) => entry.specifier)).toStrictEqual([
            'zod',
            '@kitchensink/recipe-core',
        ]);
    });

    it('documents a substantive reason for every allowlist entry and every exclusion', () => {
        for (const entry of [...ALLOWED_PACKAGE_IMPORTS, ...EXCLUDED_FILES]) {
            expect(entry.why.length).toBeGreaterThan(20);
        }
    });

    /**
     * Recipe has NO exclusions, and the assertion is the decision rather than a restatement of it.
     *
     * Food excludes `src/config/env.schema.ts` — publishing a service's env-var inventory into a package web and
     * mobile depend on, and churning `CONTRACT_HASH` on every env change. Recipe's env schema is not a
     * `*.schema.ts` at all (it lives in `src/config/config.types.ts`), so there is nothing to exclude. If a
     * `*.schema.ts` ever appears under `src/config/`, this fails and forces the exclusion decision instead of
     * letting the file be published by default.
     */
    it('publishes no schema from src/config/, because there is none to exclude', () => {
        expect(authored.filter((schema) => schema.servicePath.startsWith('src/config/'))).toStrictEqual([]);
        expect(EXCLUDED_FILES).toStrictEqual([]);
    });
});

describe('drift layer 2 — the committed package matches a fresh generation', () => {
    it('publishes exactly the authored modules, no more and no fewer', async () => {
        const published = await readdir(join(SCHEMA_PACKAGE_ROOT, 'src/schemas'));

        expect(published.sort()).toStrictEqual(authored.map((schema) => `${schema.moduleName}.ts`).sort());
    });

    it('copies every authored schema VERBATIM, under a banner naming its source', async () => {
        for (const schema of authored) {
            const committed = await readCommitted(`src/schemas/${schema.moduleName}.ts`);

            expect(committed, `${schema.moduleName}.ts is not a verbatim copy`).toContain(
                `// Source: ${SERVICE_PATH_PREFIX}/${schema.servicePath}`,
            );
            expect(committed.endsWith(flattenSiblingImports(schema.source))).toBe(true);
        }
    });

    it('marks every generated module as generated, so nobody edits one believing it is source', async () => {
        for (const schema of authored) {
            expect(await readCommitted(`src/schemas/${schema.moduleName}.ts`)).toContain('GENERATED FILE');
        }
    });

    it('re-exports every module from the schemas barrel', async () => {
        const barrel = await readCommitted('src/schemas.ts');

        for (const schema of authored) {
            expect(barrel).toContain(`export * from './schemas/${schema.moduleName}.js';`);
        }
    });

    it('exports the zod AND the contract hash from the package root', async () => {
        const index = await readCommitted('src/index.ts');

        expect(index).toContain("export * from './schemas.js';");
        expect(index).toContain("export { CONTRACT_HASH } from './contractHash.js';");
    });

    it('re-exports the inferred types type-only', async () => {
        expect(await readCommitted('src/types.ts')).toContain("export type * from './schemas.js';");
    });

    // The document is what integrators and `oasdiff` read. A committed copy that has drifted from the authored
    // zod is the exact failure this seam exists to prevent, one layer out.
    it('publishes an openapi.yaml identical to a fresh derivation from the authored zod', async () => {
        expect(await readCommitted('openapi.yaml')).toContain(stringify(built.document, { lineWidth: 120 }));
    });

    it('states in openapi.yaml that it is generated and is not the type authority', async () => {
        const committed = await readCommitted('openapi.yaml');

        expect(committed).toContain('GENERATED FILE — DO NOT EDIT');
        expect(committed).toContain('NOT the type authority');
    });
});

describe('drift layer 3 — the contract hash', () => {
    const expected = computeContractHash(authored, composed);

    it('is stamped in the schema package as the fingerprint of the authored sources', async () => {
        expect(await readCommitted('src/contractHash.ts')).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });

    // Both sides, or the runtime skew check compares a value with itself. That is the live case for mobile,
    // where a released binary cannot be updated in step with a backend deploy.
    it('is stamped identically in the SERVICE, which is what makes a skew check possible', async () => {
        const stamp = await readFile(join(SERVICE_ROOT, SERVICE_STAMP_PATH), 'utf8');

        expect(stamp).toContain(`export const CONTRACT_HASH = '${expected}';`);
    });

    /*
     * ── NON-VACUITY: the fingerprint must actually COVER the composed leaf ──────────────────────────────────
     *
     * The three assertions below are the ones whose absence let the original defect live. `collectComposedSources`
     * is unit-tested against fixtures, but a fixture cannot notice that the WIRING went away — drop the
     * `recipe-core` allowlist entry, or have the collector quietly stop following imports, and every fixture test
     * still passes while this service's hash silently returns to being blind. Recipe is the only service where
     * that is possible, so the assertion belongs here, against the real tree.
     *
     * They are also deliberately asserted BEFORE the stamp comparison could mask them: a regenerated stamp agrees
     * with an empty corpus just as happily as with a full one, so "the stamps match" is not evidence of coverage.
     */
    it('reaches the recipe-core module that DEFINES the entity bodies this API serves', () => {
        expect(composed.length).toBeGreaterThan(0);
        expect(composed.map((source) => source.key)).toContain('@kitchensink/recipe-core/src/recipe.types.ts');
    });

    it('narrows to REACHABLE modules rather than swallowing the whole composed package', () => {
        const keys = composed.map((source) => source.key);

        // Operational and policy modules of the same package: a hash that moved when a CDN-invalidation helper or
        // an infra database name changed would train every reader to regenerate without looking.
        for (const unreachable of [
            'cdnInvalidation',
            'recipeAccessPolicy',
            'recipeDatabaseName',
            'serviceErasureToken',
        ]) {
            expect(keys).not.toContain(`@kitchensink/recipe-core/src/${unreachable}.ts`);
        }
    });

    // Ties the corpus back to the allowlist: nothing may enter the fingerprint that the reviewed allowlist does
    // not admit, or the leaf property and the fingerprint would be describing different dependency sets.
    it('composes only from packages the import allowlist admits', () => {
        const admitted = ALLOWED_PACKAGE_IMPORTS.map((entry) => entry.specifier);

        for (const source of composed) {
            expect(admitted).toContain(source.packageName);
        }
    });
});

describe('the leaf property', () => {
    /**
     * The whole reason the package is a COPY rather than a re-export: a runtime dependency on NestJS, drizzle,
     * `pg` or the AWS SDK here would reach `@commise/web` and `@commise/mobile` through every consumer, and on
     * mobile that is a bundle that cannot build.
     *
     * Recipe's list is `['@kitchensink/recipe-core', 'zod']` where food's is `['zod']`, and the extra entry is
     * exactly the allowlist's second specifier — so the two assertions cannot disagree about what is admitted.
     */
    it('declares only recipe-core and zod as runtime dependencies', async () => {
        const manifest = JSON.parse(await readCommitted('package.json')) as {
            name: string;
            dependencies: Record<string, string>;
        };

        expect(manifest.name).toBe(SCHEMA_PACKAGE_NAME);
        expect(Object.keys(manifest.dependencies).sort()).toStrictEqual(['@kitchensink/recipe-core', 'zod']);
    });

    // `recipe-core` is admitted to the allowlist ON THE GROUND that it is itself a zod-only leaf. That claim is
    // the reason web and mobile can bundle this package, so it is CHECKED rather than trusted: the day
    // `recipe-core` grows a runtime dependency, this fails and the allowlist entry has to be re-justified.
    it('is only safe because recipe-core is ITSELF a zod-only leaf, so that is asserted too', async () => {
        const manifest = JSON.parse(
            await readFile(join(SERVICE_ROOT, '../../shared/recipe-core/package.json'), 'utf8'),
        ) as { dependencies: Record<string, string> };

        expect(Object.keys(manifest.dependencies)).toStrictEqual(['zod']);
    });
});

// ── GR-017 §17-c — mutating request bodies reject unknown keys ─────────────────────────────────────

/** Every component name the emitted document uses as a request body, by HTTP method. */
function requestBodyComponentsByMethod(): ReadonlyMap<string, ReadonlySet<string>> {
    const paths = built.document['paths'] as Record<
        string,
        Record<
            string,
            { readonly requestBody?: { readonly content: Record<string, { readonly schema: { $ref?: string } }> } }
        >
    >;
    const byMethod = new Map<string, Set<string>>();

    for (const methods of Object.values(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            const ref = operation.requestBody?.content['application/json']?.schema.$ref;

            if (ref === undefined) {
                continue;
            }

            const name = ref.replace('#/components/schemas/', '');

            byMethod.set(method, (byMethod.get(method) ?? new Set()).add(name));
        }
    }

    return byMethod;
}

/** The HTTP methods whose request body GR-017 §17-c governs. */
const MUTATING_METHODS: readonly string[] = ['post', 'put', 'patch', 'delete'];

/** Component names that carry a request body on a mutating operation, discovered from the document. */
const mutatingBodyComponents: readonly string[] = [
    ...new Set(
        MUTATING_METHODS.flatMap((method) => [...(requestBodyComponentsByMethod().get(method) ?? new Set<string>())]),
    ),
].sort();

/**
 * Whether a schema REJECTS an unknown key, determined BEHAVIOURALLY.
 *
 * Derived by parsing a probe body and looking for zod's own `unrecognized_keys` issue — never from the same
 * introspection the generator uses, which would make every assertion below agree with the generator by
 * construction rather than with the runtime.
 *
 * @param name - The component name, used only in failure messages.
 * @returns True when an unknown key produces an `unrecognized_keys` issue. Pure.
 */
function rejectsUnknownKeys(name: string): boolean {
    const schema = openApiComponents[name as keyof typeof openApiComponents];
    const parsed = schema.safeParse({ __unknownKeyProbe__: 'x' });

    return !parsed.success && parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
}

describe('GR-017 §17-c — every MUTATING request body rejects unknown keys', () => {
    // Non-vacuity first: the discovery must actually find bodies, or every assertion below passes over an empty
    // set. A count is deliberately NOT pinned — the point of discovery is that a new endpoint joins the set
    // without an edit here — but zero would mean the discovery itself broke.
    it('discovers the mutating request bodies from the document, and finds a substantial number', () => {
        expect(mutatingBodyComponents.length).toBeGreaterThanOrEqual(12);
    });

    it.each(mutatingBodyComponents)(
        '%s rejects an unknown key, so a misspelled field is a 400 and not a silent partial write',
        (name) => {
            expect(rejectsUnknownKeys(name), `${name} STRIPS unknown keys — see GR-017 §17-c`).toBe(true);
        },
    );

    /**
     * The document's strictness must MATCH the service's, in both directions and over EVERY component — not just
     * the mutating bodies.
     *
     * `additionalProperties: false` is a promise that an unknown key is REJECTED. A `z.object` strips and answers
     * `2xx`; only `z.strictObject` rejects. Food's generator once emitted `false` for both, which published ten
     * request bodies claiming a rejection that never happened. Recipe's document did the opposite — it claimed
     * nothing anywhere, so the strict bodies' rejection was undocumented. Either way the document and the runtime
     * must not be allowed to disagree.
     */
    it('claims to reject unknown keys ONLY where the authored zod actually rejects them', () => {
        const published = (built.document['components'] as { schemas: Record<string, Record<string, unknown>> })
            .schemas;

        const disagreements = Object.keys(openApiComponents).flatMap((name) => {
            const claim = published[name]?.['additionalProperties'];

            if (rejectsUnknownKeys(name) === (claim === false)) {
                return [];
            }

            return [
                `${name}: the document says additionalProperties=${JSON.stringify(claim)} but the zod ` +
                    `${rejectsUnknownKeys(name) ? 'REJECTS' : 'accepts and strips'} an unknown key`,
            ];
        });

        expect(disagreements).toStrictEqual([]);
    });

    /**
     * The RESPONSE components that deliberately claim rejection, each with the reason it earns the exemption.
     *
     * ⚠️ THIS LIST IS AN ARGUMENT, NOT A HOLE. The default for a response is `z.object`/`.loose()`, because a
     * client must tolerate a field a newer server added; a strict response makes adding one a BREAKING change
     * for every already-released binary. These two are the exception, and the exception is what makes the
     * contract safe rather than what weakens it:
     *
     * `RecipeNutritionResponse` is the deferred-nutrition envelope, over a union whose whole point is that
     * `unaccounted` carries NO figure — so an outage can never reach a client as `calories: 0`, a factual claim
     * about a dish. Under a loose object,
     * `{ state: 'unaccounted', reason: 'food_unavailable', caloriesPerServing: 0 }` PARSES, and the invariant
     * becomes a convention. `src/recipes/__tests__/recipeNutritionState.test.ts` asserts that exact body is
     * refused; strictness is the mechanism, not decoration.
     *
     * ⚠️ `RecipeNutritionState` itself is deliberately ABSENT from this list even though it is equally strict:
     * it is a discriminated union, so it publishes as `oneOf` and each member carries its own inline
     * `additionalProperties: false`. The assertion below reads the TOP LEVEL of each component, where a union
     * has no such keyword to claim. Adding it here would fail, and reading that failure as "the union is not
     * strict" would be wrong.
     *
     * ⛔ The accepted consequence, stated rather than discovered: adding a field to either shape is a BREAKING
     * change. A new fact about a recipe's nutrition belongs in a NEW union member (which an older client's
     * discriminated parse rejects loudly at the one recipe rather than silently everywhere), never as an extra
     * key on an existing one.
     */
    const strictResponseComponents: readonly string[] = ['RecipeNutritionResponse'];

    /**
     * NON-VACUITY for the assertion above, in the other direction, AND the record of which shapes are exempt.
     *
     * That assertion compares against `=== false`, so a generator rule that stripped the keyword WHOLESALE would
     * satisfy it trivially. So the set of components claiming rejection is pinned, and it must be exactly the
     * mutating request bodies PLUS the argued-for {@link strictResponseComponents} — nothing more (an unargued
     * response body claiming rejection would break a forward-compatible deploy) and nothing less (a mutating body
     * not claiming it is the §17-c violation).
     *
     * `z.object` ⇄ `z.strictObject` is a BREAKING wire change in one direction and a silently-permissive one in
     * the other, and neither should be possible to make by accident.
     */
    it('claims rejection on EXACTLY the mutating request bodies + the argued-for strict responses', () => {
        const published = (built.document['components'] as { schemas: Record<string, Record<string, unknown>> })
            .schemas;

        const claimingRejection = Object.entries(published)
            .filter(([, schema]) => schema['additionalProperties'] === false)
            .map(([name]) => name)
            .sort();

        expect(claimingRejection).toStrictEqual([...mutatingBodyComponents, ...strictResponseComponents].sort());
    });

    /**
     * A SECOND DISCOVERY AXIS, over the authored SOURCES rather than the document — and it exists because the
     * first axis has a hole that this suite found in itself.
     *
     * `cloneRecipeRequestSchema` is a real, authored, mutating request body (`POST …/recipes/{id}/clone`) that is
     * NOT published as a component: it has no client-controlled fields, so the document correctly declares the
     * operation with no `requestBody`. Discovering from the document therefore cannot see it, and a body that is
     * authored but undocumented is exactly the shape most likely to be forgotten — it is invisible to the reader
     * of the contract AND to a gate that reads the contract.
     *
     * So every exported binding whose name ends `RequestSchema` must reject unknown keys, whatever the document
     * says about it. Naming is the discriminant on purpose: it is the convention every authored request body in
     * this service already follows, and a new body that does not follow it fails the barrel-shape assertion
     * below rather than slipping past silently.
     */
    it('holds for every authored *RequestSchema, including the ones the document does not publish', async () => {
        const modules = await Promise.all(
            authored.map(
                async (schema) =>
                    import(join(SERVICE_ROOT, schema.servicePath.replace(/\.ts$/u, '.js'))) as Promise<
                        Record<string, unknown>
                    >,
            ),
        );

        const requestSchemas = modules.flatMap((module) =>
            Object.entries(module).filter(([name]) => name.endsWith('RequestSchema')),
        );

        // Non-vacuity: the import + filter must actually find the bodies.
        expect(requestSchemas.length).toBeGreaterThanOrEqual(13);

        const stripping = requestSchemas
            .filter(([, schema]) => {
                const parsed = (
                    schema as {
                        safeParse: (value: unknown) => { success: boolean; error?: { issues: { code: string }[] } };
                    }
                ).safeParse({ __unknownKeyProbe__: 'x' });

                return parsed.success || !parsed.error?.issues.some((issue) => issue.code === 'unrecognized_keys');
            })
            .map(([name]) => name);

        expect(stripping).toStrictEqual([]);
    });

    /**
     * THE MIRROR SWEEP, over the read queries — and it exists because the exemption was an unenforced CLAIM.
     *
     * The `*RequestSchema` sweep above discovers mutating bodies by name and requires each to REJECT. The read
     * queries are the documented exception to that rule, and until now nothing checked them at all: they are not
     * published components, so the document-driven assertions cannot see them, and they do not match
     * `*RequestSchema`, so the source-driven sweep skips them. The exemption therefore lived only in prose — which
     * means a MUTATING body could have been named `*QuerySchema` and inherited the exemption silently, and a read
     * query could have been tightened to `strictObject` (a breaking change for any caller with a tracking tag)
     * with no test to notice.
     *
     * So both directions are now asserted: the exempt set is exactly these four names, and every one of them is
     * genuinely non-strict. Adding a fifth is a visible, reviewable edit.
     */
    it('exempts EXACTLY the four read queries from strictness, and each of them really is open', async () => {
        const modules = await Promise.all(
            authored.map(
                async (schema) =>
                    import(join(SERVICE_ROOT, schema.servicePath.replace(/\.ts$/u, '.js'))) as Promise<
                        Record<string, unknown>
                    >,
            ),
        );

        const querySchemas = modules.flatMap((module) =>
            Object.entries(module).filter(([name]) => name.endsWith('QuerySchema')),
        );

        expect(querySchemas.map(([name]) => name).sort()).toStrictEqual([
            'ingredientSearchQuerySchema',
            'listCollectionsQuerySchema',
            'listRecipesQuerySchema',
            'recipeSearchQuerySchema',
        ]);

        const rejecting = querySchemas
            .filter(([, schema]) => {
                const parsed = (
                    schema as {
                        safeParse: (value: unknown) => { success: boolean; error?: { issues: { code: string }[] } };
                    }
                ).safeParse({ __unknownKeyProbe__: 'x' });

                return (
                    !parsed.success &&
                    (parsed.error?.issues.some((issue) => issue.code === 'unrecognized_keys') ?? false)
                );
            })
            .map(([name]) => name);

        expect(rejecting).toStrictEqual([]);
    });

    /**
     * The FORWARD-COMPATIBILITY EXEMPTIONS §17-c permits — now mechanically pinned rather than only described.
     *
     * FOUR are read queries: `listRecipesQuerySchema`, `listCollectionsQuerySchema`, `ingredientSearchQuerySchema`
     * and `recipeSearchQuerySchema` (the fourth, added when search's query contract was authored as zod and its
     * `class-validator` DTO retired). None is a published component — they are inlined as `parameters` — which is
     * exactly why the assertion above could not see them, and why they were an unenforced prose claim.
     *
     * The fifth is `PullDiff`: BOTH a response body and a request FIELD, where a strict version would `400` a
     * commit echoing back a document the server itself produced. See `collections.schema.ts` for the argument.
     *
     * The error envelopes are `.loose()` and stay OPEN for the mirror-image reason: an error body that grows a
     * field must not crash a client that has not been taught it.
     */
    it('leaves the round-tripped PullDiff and the four error shapes OPEN, deliberately', () => {
        const published = (built.document['components'] as { schemas: Record<string, Record<string, unknown>> })
            .schemas;

        expect(mutatingBodyComponents).not.toContain('PullDiff');
        expect(rejectsUnknownKeys('PullDiff')).toBe(false);

        // The error components are `.loose()` and stay OPEN. Both of them: `ApiError` (the permissive envelope)
        // and `RecipeApiError` (the typed union). Before the convergence this list also named `NestHttpError` and
        // `ValidationError`, which described Nest's and nestjs-zod's own bodies — shapes the filter no longer lets
        // reach the wire.
        for (const name of ['ApiError', 'ErrorResponse']) {
            expect(published[name]?.['additionalProperties'], `${name} is .loose() and must publish as open`).toEqual(
                {},
            );
        }

        // The typed union publishes as `anyOf`, so it has no `additionalProperties` of its own — its ARMS carry
        // it. Asserted so a generator change that flattened the union to a bare object would be caught here.
        expect(published['RecipeApiError']?.['anyOf'] ?? published['RecipeApiError']?.['oneOf']).toBeDefined();
    });
});

// ── The §5 ruling, enforced ────────────────────────────────────────────────────────────────────────

describe('every published component’s zod is REACHABLE from @kitchensink/schema-recipe', () => {
    /**
     * THIS IS WHAT MAKES THE §5 RULING STRUCTURAL RATHER THAN ASPIRATIONAL.
     *
     * The ruling: `@kitchensink/schema-recipe` is authoritative for every shape on the recipe wire, INCLUDING the
     * bodies that are `recipe-core` domain entities, reached by re-export from the authored schema of the vertical
     * that serves them.
     *
     * Before it, nine components (`Recipe`, `RecipeDetail`, `PaginatedRecipes`, `RecipePhoto`, `RecipePhotoList`,
     * `Ingredient`, `IngredientList`, `RecipeVersion`, `RecipeVersionList`) were DOCUMENTED by this contract while
     * their zod was not exported from the package the document points a consumer at. So "which package is the
     * source for this endpoint's shape?" had a per-endpoint answer, and GR-017 §17-b.2 — a client imports its wire
     * types AND its runtime zod from the schema package — was not satisfiable.
     *
     * The check is on the AUTHORED sources rather than the generated package, because the generated files are a
     * verbatim copy: if a symbol is exported from an authored module it is exported from the barrel, and drift
     * layer 2 above already proves the copy. Asserting here means a NEW component that forgets its re-export
     * fails immediately, naming itself.
     */
    it('exports zod for every component the document declares', async () => {
        const sources = await Promise.all(
            authored.map(async (schema) => readCommitted(`src/schemas/${schema.moduleName}.ts`)),
        );
        const published = sources.join('\n');

        // The symbol each component is built from, as it must appear in an `export` of some authored module. Only
        // the composed/derived components are absent: those are `z.array(...)` and `paginatedResponseSchema(...)`
        // applications built in `contract/openapi.ts`, whose ELEMENT schema is what a consumer needs.
        const unreachable = Object.entries(openApiComponents)
            .map(([name, schema]) => ({ name, schema }))
            .filter(({ name }) => {
                const symbol = COMPONENT_SYMBOL[name];

                return symbol !== undefined && !new RegExp(`\\b${symbol}\\b`, 'u').test(published);
            })
            .map(({ name }) => name);

        expect(unreachable).toStrictEqual([]);
    });

    // Every component that has a NAMED zod binding, mapped to that binding. A component built inline in the route
    // table (`z.array(x)`, `paginatedResponseSchema(x)`) has no symbol of its own and maps its ELEMENT instead,
    // which is the schema a consumer actually parses with.
    const COMPONENT_SYMBOL: Readonly<Record<string, string>> = {
        // `ErrorResponse` is an ALIAS of the envelope, kept so ~120 existing `$ref`s keep resolving.
        ErrorResponse: 'apiErrorSchema',
        ApiError: 'apiErrorSchema',
        RecipeApiError: 'recipeApiErrorSchema',
        HealthStatus: 'healthStatusSchema',
        Recipe: 'recipeSchema',
        RecipeDetail: 'recipeDetailSchema',
        PaginatedRecipes: 'paginatedResponseSchema',
        CreateRecipeRequest: 'createRecipeRequestSchema',
        UpdateRecipeRequest: 'updateRecipeRequestSchema',
        RecipeNutritionRequest: 'recipeNutritionRequestSchema',
        RecipeNutritionState: 'recipeNutritionStateSchema',
        RecipeNutritionResponse: 'recipeNutritionResponseSchema',
        SetRecipeVisibilityRequest: 'setRecipeVisibilityRequestSchema',
        SetRatingRequest: 'setRatingRequestSchema',
        RecipePhoto: 'recipePhotoSchema',
        RecipePhotoList: 'recipePhotoSchema',
        CreatePhotoUploadRequest: 'createPhotoUploadRequestSchema',
        PhotoUploadUrlResponse: 'photoUploadUrlResponseSchema',
        ConfirmPhotoRequest: 'confirmPhotoRequestSchema',
        ReorderPhotosRequest: 'reorderPhotosRequestSchema',
        Ingredient: 'ingredientSchema',
        IngredientList: 'ingredientSchema',
        IngredientCandidateList: 'ingredientCandidatesResponseSchema',
        IngredientSuggestions: 'ingredientSuggestionsResponseSchema',
        CreateIngredientRequest: 'createIngredientRequestSchema',
        AddIngredientByFoodRequest: 'addIngredientByFoodRequestSchema',
        ResolveIngredientRequest: 'resolveIngredientRequestSchema',
        RecipeVersion: 'recipeVersionSchema',
        RecipeVersionList: 'recipeVersionSchema',
        RestoreVersionResponse: 'restoreVersionResponseSchema',
        RecipeSearchResponse: 'recipeSearchResponseSchema',
        Collection: 'collectionResponseSchema',
        PaginatedCollections: 'collectionListResponseSchema',
        CollectionMemberRecipe: 'collectionMemberRecipeSchema',
        CollectionWithRecipes: 'collectionWithRecipesResponseSchema',
        CollectionRecipeMembership: 'collectionRecipeMembershipResponseSchema',
        CreateCollectionRequest: 'createCollectionRequestSchema',
        UpdateCollectionRequest: 'updateCollectionRequestSchema',
        AddRecipeToCollectionRequest: 'addRecipeToCollectionRequestSchema',
        CloneCollectionRequest: 'cloneCollectionRequestSchema',
        PullDiff: 'pullDiffSchema',
        PullFromSourceRequest: 'pullFromSourceRequestSchema',
        PullFromSourceResponse: 'pullFromSourceResponseSchema',
        AccountExport: 'accountExportSchema',
        ErasureRequest: 'erasureRequestSchema',
        ErasureRequestAcceptedResponse: 'erasureRequestAcceptedResponseSchema',
        ServiceErasureAcceptedResponse: 'serviceErasureAcceptedResponseSchema',
    };

    // The map above is a second list of the components, so it must be EXHAUSTIVE or the check silently skips a
    // component. Asserted in both directions.
    it('maps every component to a zod symbol, and maps no component that does not exist', () => {
        expect(Object.keys(COMPONENT_SYMBOL).sort()).toStrictEqual(Object.keys(openApiComponents).sort());
    });
});
