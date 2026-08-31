/**
 * Repo-wide guard: the ECR retention policy (`.github/scripts/ecr-lifecycle-policy.json`).
 *
 * ## What is actually dangerous here
 *
 * The repositories are shared: every push to every PR builds into the SAME repository prod releases into,
 * so previews outnumber releases by roughly 26:1. `ecr-ensure-repo.sh` re-applies this document on every
 * deploy, at six call sites, which means a bad edit reaches all three repositories without a migration and
 * without review of the resulting expiry set.
 *
 * The images prod RUNS are not protected by being recent — they are old. When the policy was first written
 * they sat at ranks #202, #241 and #201 by push date, behind ~200 newer preview builds, so a plausible
 * "keep the newest N" edit would have deleted the running release. What protects them is that a prod tag is
 * a **bare 40-hex git SHA**, which matches neither preview prefix, so no rule's SELECTION can name it.
 *
 * That is the invariant this suite exists to hold: **the retention count is a tuning knob, the structural
 * exclusion is not.** Lowering 50 to 20 is a cost decision; relaxing a rule to `tagStatus: "any"`, or
 * dropping a `tagPrefixList`, silently converts the count into the only thing standing between a deploy and
 * the running release. Both of those are fired at deliberately violating fakes below, because a predicate
 * that has only ever seen the passing document has not been shown to detect anything.
 *
 * ## Why the count is asserted at all
 *
 * `RETENTION` is not derived from anything a test can recompute, so asserting it is a change-detector by
 * construction. It earns its place by pinning the number to the measurement that chose it: a real
 * `start-lifecycle-policy-preview` at 50 over the live repositories (2026-08-30) selected 450 images and
 * 272 GB, took ECR from $38.64 to $11.40/month, and named **zero** prod-shaped tags. A future edit that
 * moves this number is obliged to re-run that preview — the script's own docstring says so — and this
 * assertion is what makes the obligation fail loudly rather than be forgotten.
 *
 * DESIGN PATTERN: Specification module over one document — {@link rulesSelecting} is a pure verdict over a
 * policy value, so it is fired at fakes as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const POLICY_PATH = fileURLToPath(new URL('../../../../.github/scripts/ecr-lifecycle-policy.json', import.meta.url));

/** The preview-image retention count both preview rules carry. See the docstring for what pins it. */
const RETENTION = 50;

/** A prod release tag: the bare 40-hex git SHA the deploy workflows push. Matches neither preview prefix. */
const PROD_TAG = '67f56925ef02406f9e6b4530c868e914cb555daa';

/** The two tag prefixes every preview build carries (`sandbox-{sha}`, `pr-{n}-{sha}`). */
const PREVIEW_TAGS = ['sandbox-a0a967e2293b7359258289987860b785d665ae75', 'pr-91-79287b6de893d138d0a4a98ab13ac3b5'];

/** One rule's image selection, as ECR's lifecycle grammar defines it. */
interface RuleSelection {
    readonly tagStatus: 'tagged' | 'untagged' | 'any';
    readonly tagPrefixList?: readonly string[];
    readonly countType: string;
    readonly countNumber: number;
}

/** One lifecycle rule. */
interface LifecycleRule {
    readonly rulePriority: number;
    readonly description: string;
    readonly selection: RuleSelection;
    readonly action: { readonly type: string };
}

/** An ECR lifecycle policy document. */
interface LifecyclePolicy {
    readonly rules: readonly LifecycleRule[];
}

/**
 * The priorities of every rule whose SELECTION can name `tag`, ignoring the count.
 *
 * Counting is deliberately not modelled: it depends on the repository's push history, which a unit test
 * cannot see, and it is not what protects the running release. Selection is. A rule that cannot name a tag
 * can never expire it however low its count goes.
 *
 * @param policy - The parsed lifecycle document.
 * @param tag - A single image tag.
 * @returns Matching rule priorities, ascending. Pure.
 */
export function rulesSelecting(policy: LifecyclePolicy, tag: string): number[] {
    return policy.rules
        .filter(({ selection }) => {
            if (selection.tagStatus === 'untagged') {
                return false;
            }

            if (selection.tagStatus === 'any') {
                return true;
            }

            // `tagged` with no prefix list selects EVERY tagged image, prod releases included.
            const prefixes = selection.tagPrefixList ?? [];

            if (prefixes.length === 0) {
                return true;
            }

            return prefixes.some((prefix) => tag.startsWith(prefix));
        })
        .map(({ rulePriority }) => rulePriority)
        .sort((a, b) => a - b);
}

const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as LifecyclePolicy;

describe('ECR retention policy (.github/scripts/ecr-lifecycle-policy.json)', () => {
    it('no rule can name a prod release tag, so the running image is excluded structurally', () => {
        expect(rulesSelecting(policy, PROD_TAG)).toEqual([]);
    });

    it('does select both preview tag shapes, so the guard above is not vacuous', () => {
        for (const tag of PREVIEW_TAGS) {
            expect(rulesSelecting(policy, tag)).not.toEqual([]);
        }
    });

    it('retains the measured number of preview images per prefix', () => {
        const counts = policy.rules
            .filter(({ selection }) => (selection.tagPrefixList ?? []).length > 0)
            .map(({ selection }) => selection.countNumber);

        expect(counts).toEqual([RETENTION, RETENTION]);
    });

    it('expires untagged images, which is what keeps overwritten layers from accumulating', () => {
        const untagged = policy.rules.filter(({ selection }) => selection.tagStatus === 'untagged');

        expect(untagged).toHaveLength(1);
        expect(untagged[0]?.action.type).toBe('expire');
    });

    it('every rule expires — a retention document has no other verb', () => {
        for (const rule of policy.rules) {
            expect(rule.action.type).toBe('expire');
        }
    });

    describe('detects the two edits that would delete the running release', () => {
        const withSelection = (selection: Partial<RuleSelection>): LifecyclePolicy => ({
            rules: [
                {
                    rulePriority: 1,
                    description: 'fake',
                    selection: { tagStatus: 'tagged', countType: 'imageCountMoreThan', countNumber: 50, ...selection },
                    action: { type: 'expire' },
                },
            ],
        });

        it('catches a rule relaxed to tagStatus "any"', () => {
            expect(rulesSelecting(withSelection({ tagStatus: 'any' }), PROD_TAG)).toEqual([1]);
        });

        it('catches a tagged rule that lost its tagPrefixList', () => {
            expect(rulesSelecting(withSelection({ tagPrefixList: [] }), PROD_TAG)).toEqual([1]);
        });

        it('leaves a correctly prefixed rule alone', () => {
            expect(rulesSelecting(withSelection({ tagPrefixList: ['pr-'] }), PROD_TAG)).toEqual([]);
        });
    });
});
