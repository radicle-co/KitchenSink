// @vitest-environment node
/**
 * Repo-wide guard on the CONSUMER half of `docs/CODING_STANDARDS.md` §15 / ADR-0014: every client and app
 * takes its wire types and zod from `@kitchensink/schema-<service>`, declares none of its own, and PARSES
 * what the server sends.
 *
 * The rules live in `./wireContractConsumers.ts`; this file is what makes them binding, and it has two
 * halves that answer two different questions.
 *
 *  1. **MUTATION PROOFS (`the rules`).** Each rule is driven against a FIXTURE package under
 *     `fixtures/wire-contract/` that violates exactly one of them, plus a compliant fixture that must stay
 *     silent. This is the half that matters most, and the reason it exists is uncomfortable but concrete: the
 *     first version of the response-validation check was a grep for `\.(parse|safeParse)\(`, which also
 *     matches `Date.parse(` — so it reported validation in a client that cast every body, and the "coverage"
 *     it measured was an artifact of the tool. A gate nobody has watched go red is a gate nobody knows works,
 *     so every rule here is watched going red on purpose.
 *
 *  2. **THE REAL TREE (`the repository's clients and apps`).** The same rules, run against every package
 *     DISCOVERED under `packages/clients/*` and `packages/apps/`. Discovery, never an enumerated list: the
 *     owner's requirement is that this holds "on existing clients and future clients", and a hardcoded list
 *     satisfies only the first half. A `packages/clients/stripe` added tomorrow is covered the day it lands,
 *     and it does NOT inherit `packages/clients/usda`'s §15.3 exemption — that exemption is an opt-out marker
 *     in usda's own `package.json`, so a new package must state its own case, with a reason, to get one.
 *
 * ⚠️ NO BASELINE, deliberately. The tempting shape for a rule with existing violations is a checked-in
 * allowlist that only fails on growth (`boundariesRatchet` does exactly that, for reasons it documents). It
 * is not appropriate here: the violation count is small enough to drive to zero in the same change that adds
 * the gate, and a baseline would freeze in place the specific casts — `JSON.parse(text) as T` in three
 * separate hand-rolled transports — that this gate exists to remove.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    RULE_DECLARES_WIRE_SHAPE,
    RULE_EXEMPTION_NEEDS_REASON,
    RULE_EXEMPTION_NEEDS_ZOD,
    RULE_MISSING_SCHEMA_DEPENDENCY,
    RULE_SCHEMA_TYPES_ONLY,
    RULE_UNVALIDATED_RESPONSE_BODY,
    auditConsumerPackage,
    claimsThirdPartyExemption,
    collectPublishedContractNames,
    discoverConsumerPackages,
    formatViolations,
    readPublishedContractNames,
} from './wireContractConsumers.js';
import type { ConsumerManifest, ConsumerPackage } from './wireContractConsumers.js';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/wire-contract');

/**
 * Load a fixture package as the pure analysis input.
 *
 * Fixture sources carry a `.ts.fixture` extension, NOT `.ts`. That is what keeps them out of this package's
 * `tsc --noEmit`, its prettier run, and any editor's module resolution — a fixture that imports
 * `@kitchensink/schema-food` (which it must, to exercise the import rules) is unresolvable from here, and a
 * real `.ts` file would red `typecheck` for a reason that has nothing to do with the rule being tested.
 *
 * @param name - The fixture directory name.
 * @param kind - `client` (held to every rule by LOCATION) or `app` (held to the client rules only when it
 *   actually issues HTTP requests at one of our versioned paths).
 * @returns The fixture as a {@link ConsumerPackage}.
 * @sideEffect Reads from disk.
 */
function loadFixture(name: string, kind: 'client' | 'app' = 'client'): ConsumerPackage {
    const dir = path.join(fixturesRoot, name);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as ConsumerManifest;
    const sources = readdirSync(path.join(dir, 'src'))
        .filter((file) => file.endsWith('.ts.fixture'))
        .sort()
        .map((file) => ({
            path: `fixtures/wire-contract/${name}/src/${file.replace('.fixture', '')}`,
            text: readFileSync(path.join(dir, 'src', file), 'utf8'),
        }));

    return {
        dir: kind === 'client' ? `packages/clients/${name}` : `packages/apps/commise/${name}`,
        kind,
        manifest,
        sources,
    };
}

/**
 * The published vocabulary the fixtures are checked against — a small, fixed stand-in for
 * `packages/schemas/*`, so a fixture's expectations cannot shift when a real contract gains an export.
 */
const fixturePublishedNames = collectPublishedContractNames([
    {
        path: 'fixtures/schema-thing/src/schemas.ts',
        text: `
            import { z } from 'zod';
            export const createThingRequestSchema = z.object({ name: z.string() });
            export type CreateThingRequest = z.infer<typeof createThingRequestSchema>;
            export const thingResponseSchema = z.object({ id: z.string() });
            export type ThingResponse = z.infer<typeof thingResponseSchema>;
            export interface AvatarPresignResponse { uploadUrl: string }
        `,
    },
]);

/** Rule ids present in a violation list, deduplicated and sorted — the assertion surface for the proofs. */
function rulesFired(pkg: ConsumerPackage): readonly string[] {
    return [...new Set(auditConsumerPackage(pkg, fixturePublishedNames).map((violation) => violation.rule))].sort();
}

describe('the rules (fixture-driven mutation proofs)', () => {
    it('reads the published vocabulary from exported types, interfaces AND const schemas', () => {
        // All three matter: a consumer can collide with a `z.infer` type alias, a hand-written interface in a
        // contract, or the zod const itself.
        expect([...fixturePublishedNames].sort()).toStrictEqual([
            'AvatarPresignResponse',
            'CreateThingRequest',
            'ThingResponse',
            'createThingRequestSchema',
            'thingResponseSchema',
        ]);
    });

    it('stays silent on a compliant client — the gate must be satisfiable, not merely strict', () => {
        expect(formatViolations(auditConsumerPackage(loadFixture('compliant'), fixturePublishedNames))).toBe('');
    });

    it('fires when a client DECLARES a shape the contract already publishes', () => {
        const violations = auditConsumerPackage(loadFixture('declares-wire-type'), fixturePublishedNames);

        expect(violations.map((violation) => violation.rule)).toContain(RULE_DECLARES_WIRE_SHAPE);
        // Both flavours: a name that collides with a published export, and a fresh declaration under a
        // wire-envelope suffix that the contract does not (yet) publish.
        expect(
            violations
                .filter((v) => v.rule === RULE_DECLARES_WIRE_SHAPE)
                .map((v) => v.symbol)
                .sort(),
        ).toStrictEqual(['CreateThingRequest', 'ThingListResponse']);
    });

    it('accepts a DERIVED shape — Pick/Omit/Partial/indexed access/extends are the sanctioned escape', () => {
        // The compliant fixture derives four different ways. If any of them tripped the rule, the rule would
        // be pushing authors back toward re-declaration, which is the opposite of its purpose.
        expect(rulesFired(loadFixture('compliant'))).toStrictEqual([]);
    });

    it('accepts a wire-NAMED local shape only when it is tagged with a substantive reason', () => {
        // `RawResponse` in both real clients is a transport envelope, not a wire shape. The tag is how that is
        // said out loud; `tagged-without-reason` carries the tag with no justification and still fires.
        expect(rulesFired(loadFixture('tagged-without-reason'))).toStrictEqual([RULE_DECLARES_WIRE_SHAPE]);
    });

    it('fires when a client reads a response body, casts it, and never parses it', () => {
        const violations = auditConsumerPackage(loadFixture('casts-unparsed-body'), fixturePublishedNames);
        const unvalidated = violations.filter((violation) => violation.rule === RULE_UNVALIDATED_RESPONSE_BODY);

        expect(unvalidated.map((violation) => violation.symbol).sort()).toStrictEqual(['getThing', 'toError']);
    });

    // THE REGRESSION THAT MOTIVATED THE AST WALK. A grep for `.parse(` counts these as validation.
    it('does NOT count Date.parse or JSON.parse as contract validation', () => {
        const violations = auditConsumerPackage(loadFixture('fake-parse-calls'), fixturePublishedNames);

        expect(violations.map((violation) => violation.rule)).toContain(RULE_UNVALIDATED_RESPONSE_BODY);
    });

    it('does NOT mistake an object literal’s `body:` field for a response body', () => {
        // A design-token module full of `lineHeightRatio.body` tripped an earlier draft of this rule. The
        // receiver restriction is what fixed it, and this is what keeps it fixed.
        // Loaded as an APP: a package that issues no HTTP request at one of our paths is not held to the
        // client rules at all, which is the other half of what keeps `@commise/ui` and `@commise/i18n` quiet.
        expect(rulesFired(loadFixture('design-tokens', 'app'))).toStrictEqual([]);
    });

    it('accepts an unparsed boundary that names its reason, at function granularity', () => {
        expect(rulesFired(loadFixture('unparsed-boundary-tagged'))).toStrictEqual([]);
    });

    it('fires when a client that speaks to our API declares no schema-package dependency', () => {
        expect(rulesFired(loadFixture('missing-schema-dependency'))).toStrictEqual([RULE_MISSING_SCHEMA_DEPENDENCY]);
    });

    it('fires when the schema package is imported for TYPES only — a contract with no validator', () => {
        // BOTH rules fire, and that is the honest answer rather than a looser assertion: a type-only import is
        // the manifest-level symptom and the unparsed cast is the runtime consequence. They are reported
        // separately because they have different fixes — declare the value import, AND run it.
        expect(rulesFired(loadFixture('types-only-import'))).toStrictEqual([
            RULE_SCHEMA_TYPES_ONLY,
            RULE_UNVALIDATED_RESPONSE_BODY,
        ]);
    });

    describe('the third-party exemption (§15.3)', () => {
        it('is an opt-out MARKER in the package, so a new client cannot inherit one by sitting beside usda', () => {
            const bare: ConsumerManifest = { name: '@kitchensink/stripe-client' };

            expect(claimsThirdPartyExemption(bare)).toBe(false);
            // The real exemption holder claims it explicitly, in its own manifest.
            const usda = JSON.parse(
                readFileSync(path.join(repoRoot, 'packages/clients/usda/package.json'), 'utf8'),
            ) as ConsumerManifest;

            expect(claimsThirdPartyExemption(usda)).toBe(true);
        });

        it('exempts a marked package from the schema-package and declaration rules', () => {
            expect(rulesFired(loadFixture('third-party-exempt'))).toStrictEqual([]);
        });

        it('fires when the exemption carries no substantive reason', () => {
            expect(rulesFired(loadFixture('exempt-without-reason'))).toStrictEqual([RULE_EXEMPTION_NEEDS_REASON]);
        });

        // The exemption RELOCATES the contract; it never removes the boundary check. Applying it to a package
        // with no zod at all turns "we do not own this type" into "we trust this JSON", which is the specific
        // damage ADR-0014 says the exception exists to prevent.
        it('fires when an exempt package cannot validate at all (no zod)', () => {
            expect(rulesFired(loadFixture('exempt-without-zod'))).toStrictEqual([RULE_EXEMPTION_NEEDS_ZOD]);
        });
    });
});

describe("the repository's clients and apps", () => {
    const consumers = discoverConsumerPackages(repoRoot);
    const publishedNames = readPublishedContractNames(repoRoot);

    it('DISCOVERS every client and app package, so the assertions below are not vacuous', () => {
        expect(consumers.map((consumer) => consumer.dir).sort()).toStrictEqual([
            'packages/apps/commise/features/account',
            'packages/apps/commise/features/core',
            'packages/apps/commise/features/recipes',
            'packages/apps/commise/i18n',
            'packages/apps/commise/mobile',
            // The app-wide TanStack Query configuration. It declares no wire type of its own — it composes
            // the two clients' retry Specifications — but it depends on a client, so discovery finds it and
            // §15's rules run over it like any other consumer.
            'packages/apps/commise/query',
            'packages/apps/commise/ui',
            'packages/apps/commise/web',
            'packages/clients/bedrock',
            'packages/clients/food-service',
            'packages/clients/recipe-service',
            'packages/clients/usda',
        ]);
    });

    it('reads a non-trivial published vocabulary from packages/schemas/*', () => {
        // A silent failure mode worth pinning: if discovery of the schema sources broke, `publishedNames`
        // would be empty and the name-collision half of the declaration rule would pass by doing nothing.
        expect(publishedNames.size).toBeGreaterThan(100);
        expect(publishedNames.has('CreateRecipeRequest')).toBe(true);
        expect(publishedNames.has('AvatarPresignResponse')).toBe(true);
    });

    it.each(consumers.map((consumer) => [consumer.dir, consumer] as const))(
        '%s takes its wire types and zod from the published contract',
        (_dir, consumer) => {
            const violations = auditConsumerPackage(consumer, publishedNames);

            expect(formatViolations(violations), `\n${formatViolations(violations)}\n`).toBe('');
        },
    );
});
