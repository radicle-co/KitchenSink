/**
 * @module policySet — every managed policy document the owner-only policy stack deploys, rendered.
 *
 * One place that answers "which documents exist": the three boundaries and every part of the three execution roles.
 * The guards that read rendered documents (grammar, action catalogue) and `scripts/validatePolicies.ts` all go
 * through it, so a document added to the stack cannot escape them.
 */
import { buildBoundary } from './boundary.js';
import { buildExecutionPolicy } from './executionPolicy.js';
import { renderDocument, type PolicyDocument, type RenderContext } from './policyDocument.js';
import { boundaryPolicyName, QUALIFIERS, type QualifierName } from './qualifiers.js';

/** One rendered managed policy. */
export interface NamedPolicy {
    readonly name: string;
    readonly qualifier: QualifierName;
    readonly document: PolicyDocument;
}

/**
 * Every managed policy of the policy stack, with the account and region filled in.
 *
 * @param context - The deployment values.
 * @returns The documents, boundary first per qualifier. Pure.
 */
export function renderedPolicies(context: RenderContext): readonly NamedPolicy[] {
    return Object.values(QUALIFIERS).flatMap((qualifier) => [
        {
            name: boundaryPolicyName(qualifier),
            qualifier,
            document: renderDocument(buildBoundary(qualifier), context),
        },
        ...buildExecutionPolicy(qualifier).map((part) => ({
            name: part.policyName,
            qualifier,
            document: renderDocument(part.document, context),
        })),
    ]);
}
