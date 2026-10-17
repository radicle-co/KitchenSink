// @vitest-environment node
/**
 * Repo-wide guard: every caller of `deployGate.sh evaluate` tells the gate which catalog seed its leg holds (curated
 * catalog plan KTD-5).
 *
 * The gate's stay-current term redeploys a serving preview whose database does not record the seed its function
 * holds. It reads that from the `<seedRef>` argument: `none` for a leg with no seed, `<schemaStack>:<outputKey>` for the
 * food leg. A food caller that passed `none` would never notice a stale catalog, and the gate cannot tell the
 * difference, so the callers are checked here.
 *
 * Discovered, not enumerated: every workflow that invokes the gate is read, every continued command joined, and every
 * call judged by the service it names. The rule is fired at fixtures that break it as well as at the tree.
 *
 * DESIGN PATTERN: Specification module over a pure predicate ({@link seedRefViolations}).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** The food leg's seed reference, as the callers spell it. */
const FOOD_SEED_REF = /kitchensink-food-schema-\$\{STAGE\}:FoodSeedFunctionName/u;

/**
 * Join backslash-continued lines, so one shell command reads as one line.
 *
 * @param text - Workflow text.
 * @returns The text with every continuation folded into its command. Pure.
 */
function joinContinuations(text: string): string {
    return text.replace(/\\\n\s*/gu, ' ');
}

/**
 * Every way a workflow can call the gate without saying which seed its leg holds.
 *
 * @param workflow - One workflow's name, for the messages.
 * @param text - Its text.
 * @returns One message per violation. Pure.
 */
export function seedRefViolations(workflow: string, text: string): readonly string[] {
    const violations: string[] = [];
    const lines = joinContinuations(text).split('\n');

    for (const line of lines) {
        const literal = /deployGate\.sh evaluate\s+\S+\s+(food|recipe)\b(.*)$/u.exec(line);

        if (literal !== null) {
            const [, service, rest] = literal;

            if (service === 'food' && !FOOD_SEED_REF.test(rest ?? '')) {
                violations.push(`${workflow}: the food gate call does not name the food seed function`);
            }

            if (service === 'recipe' && !/\snone\s/u.test(` ${rest ?? ''} `)) {
                violations.push(`${workflow}: the recipe gate call does not pass the seed reference none`);
            }
        }

        const helperCall = /\bask\s+(food|recipe)\s+("[^"]*"|\S+)\s+("[^"]*"|\S+)/u.exec(line);

        if (helperCall !== null) {
            const [, service, , seed] = helperCall;

            if (service === 'food' && !FOOD_SEED_REF.test(seed ?? '')) {
                violations.push(`${workflow}: 'ask food' does not pass the food seed function as its seed reference`);
            }

            if (service === 'recipe' && seed !== 'none') {
                violations.push(`${workflow}: 'ask recipe' does not pass the seed reference none`);
            }
        }

        if (/deployGate\.sh evaluate\s+true\s+"\$\{service\}"/u.test(line) && !line.includes('"${seed}"')) {
            violations.push(`${workflow}: the 'ask' helper does not forward its seed reference to the gate`);
        }
    }

    return violations;
}

/** Every workflow that calls the gate. */
function gateCallers(): readonly { readonly name: string; readonly text: string }[] {
    const dir = path.join(repoRoot, '.github', 'workflows');

    return readdirSync(dir)
        .filter((name) => name.endsWith('.yml'))
        .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }))
        .filter((workflow) => workflow.text.includes('deployGate.sh evaluate'));
}

describe('every deploy-gate caller names the seed its leg holds', () => {
    it('finds the callers at all', () => {
        expect(gateCallers().map((workflow) => workflow.name)).toEqual(
            expect.arrayContaining(['_ci.yml', '_ci-heavy.yml', 'deployedE2e.yml', 'sandboxPreview.yml']),
        );
    });

    it('⛔ passes a seed reference on every call in the tree', () => {
        expect(gateCallers().flatMap((workflow) => seedRefViolations(workflow.name, workflow.text))).toStrictEqual([]);
    });
});

describe('the rule fires — at callers built to break it', () => {
    const helper = [
        '                  ask() {',
        "                      GITHUB_OUTPUT='' bash .github/scripts/deployGate.sh evaluate \\",
        '                          true "${service}" false false "${health}" "${DEFAULT_AWS_REGION}" "${seed}" "$@"',
        '                  }',
    ].join('\n');

    it.each<[string, string, string]>([
        [
            'a literal food call with no seed reference',
            '.github/scripts/deployGate.sh evaluate "$INTENT" food "$CHANGED" "$FORCED" \\\n "$URL" \\\n "${DEFAULT_AWS_REGION}" \\\n "kitchensink-food-service-${STAGE}"',
            'food gate call',
        ],
        [
            'a literal recipe call with no seed reference',
            '.github/scripts/deployGate.sh evaluate "$INTENT" recipe "$CHANGED" "$FORCED" \\\n "$URL" \\\n "${DEFAULT_AWS_REGION}" \\\n "kitchensink-recipe-service-${STAGE}"',
            'recipe gate call',
        ],
        [
            "an 'ask food' with none",
            `${helper}\n food_verdict=$(ask food "\${FOOD_ORIGIN}/health" none \\\n "kitchensink-food-service-\${STAGE}")`,
            "'ask food'",
        ],
        [
            "an 'ask recipe' with the food seed",
            `${helper}\n recipe_verdict=$(ask recipe "\${RECIPE_ORIGIN}/health" "kitchensink-food-schema-\${STAGE}:FoodSeedFunctionName" x)`,
            "'ask recipe'",
        ],
        [
            'a helper that drops the seed',
            '                      GITHUB_OUTPUT=\'\' bash .github/scripts/deployGate.sh evaluate \\\n                          true "${service}" false false "${health}" "${DEFAULT_AWS_REGION}" "$@"',
            'does not forward',
        ],
    ])('catches %s', (_case, text, message) => {
        const found = seedRefViolations('fake.yml', text);

        expect(found).toHaveLength(1);
        expect(found[0]).toContain(message);
    });

    it('passes well-formed callers', () => {
        expect(
            seedRefViolations(
                'fake.yml',
                `${helper}\n recipe_verdict=$(ask recipe "\${RECIPE_ORIGIN}/health" none \\\n "x")\n food_verdict=$(ask food "\${FOOD_ORIGIN}/health" \\\n "kitchensink-food-schema-\${STAGE}:FoodSeedFunctionName" \\\n "y")`,
            ),
        ).toStrictEqual([]);
    });
});
