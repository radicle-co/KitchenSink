/**
 * What a recipe needs before it may be PUBLISHED, named so a refusal can say which (owner rulings 2026-10-13). The
 * recipe service's `evaluatePublication` decides; this module is only the vocabulary it answers in, shared with every
 * client so a refusal maps to the client's own localized copy rather than to parsed text.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Registry — a closed `as const` tuple, its union and its runtime validator
 */
import { z } from 'zod';

/**
 * Every publish requirement, in the editor's PAGE order (the cuisine is in Details, before Ingredients and Steps), which
 * is the order a refusal lists them in.
 */
export const PUBLISH_REQUIREMENTS = ['cuisine', 'ingredients', 'steps'] as const;

/** One publish requirement. */
export type PublishRequirement = (typeof PUBLISH_REQUIREMENTS)[number];

/** Runtime validator for {@link PublishRequirement}. */
export const publishRequirementSchema = z.enum(PUBLISH_REQUIREMENTS);

/**
 * The `details` of a `PUBLISH_REQUIREMENTS_UNMET` refusal: every requirement the recipe does not meet, at least one.
 * Composed into the service's typed error arm, the way `versionConflictDetailsSchema` is.
 */
export const publishRequirementsUnmetDetailsSchema = z.object({
    missing: z.array(publishRequirementSchema).min(1),
});

/** The `details` of a `PUBLISH_REQUIREMENTS_UNMET` refusal. */
export type PublishRequirementsUnmetDetails = z.infer<typeof publishRequirementsUnmetDetailsSchema>;
