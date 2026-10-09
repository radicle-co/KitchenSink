/**
 * @module @commise/ui/recipe-cover — the shared contract of the design-system `RecipeCover`
 * (`docs/design/uiOverhaul/buildSpec.md` §1.8): a recipe's photo, or its monogram when it has none.
 */

/** The cover's shape: a 4:3 card, a 1:1 thumbnail, or the 96 px band across a phone's detail hero. */
export type CoverAspect = '4:3' | '1:1' | 'band';

/** The cross-platform `RecipeCover` contract. */
export interface RecipeCoverProps {
    /** The recipe's id, which picks the monogram's tint, so a recipe looks the same everywhere. */
    readonly recipeId: string;
    /** The recipe's title, whose first letter the monogram shows. */
    readonly title: string;
    /** The cuisine, shown under the monogram's letter on a cover 96 px tall or taller. */
    readonly cuisine?: string;
    /** The photo. Without one the cover is a monogram (a Null Object for the missing photo). */
    readonly photoUrl?: string;
    /** The shape the caller reserves, so nothing moves as the image loads. */
    readonly aspect: CoverAspect;
}

/** The height from which a monogram shows its cuisine, in px or points (§1.8). */
export const OVERLINE_FROM = 96;

/** The monogram letter's size, as a share of the cover's height (§1.8). */
export const LETTER_SHARE = 0.4;
