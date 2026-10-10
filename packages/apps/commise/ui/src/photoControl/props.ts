/**
 * @module @commise/ui/photo-control — the shared contract of the design-system `PhotoControl`: one round control that
 * sits over a photo, such as the recipe hero's back and ⋯ buttons (D12; `docs/design/uiOverhaul/modernizeA.md` §5).
 *
 * - **iOS 26:** a 44 pt disc of regular Liquid Glass, untinted, because a user's photo can be any brightness.
 * - **Android, older iOS and web:** a solid 44 px `photoChip` disc. Web blurs only small fixed bars, never a disc.
 *
 * It carries a glyph, never text: the rule is that no text we own sits on glass over a photo.
 */
import type { IconName } from '../icon/props.js';

/** Props for the `PhotoControl` leaves (web and native). */
export interface PhotoControlProps {
    /** The glyph on the disc. Decorative: the control's name is `label`. */
    readonly icon: IconName;
    /** The control's accessible name, localised by the caller ("Back", "More actions"). */
    readonly label: string;
    /** Called on a press. */
    readonly onPress: () => void;
}
