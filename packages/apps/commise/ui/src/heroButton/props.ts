/**
 * @module @commise/ui/hero-button — the shared contract of the design-system `HeroButton`: one round control over a
 * photo — the recipe page's Back and ⋯ (D12; `docs/design/uiOverhaul/modernizeA.md` §5; `buildSpec.md` §3.5, §6.1).
 *
 * - **iOS 26:** a 44 pt disc of regular Liquid Glass, untinted, because a user's photo can be any brightness.
 * - **Android, older iOS and web:** a solid 44 px `photoChip` disc. Web blurs only small fixed bars, never a disc.
 *
 * It carries a glyph, never text: no text we own sits on glass over a photo. Unlike `PhotoControl` it can be a real
 * link on web (a Back that opens in a new tab), take a screen-reader focus request, and report an open/closed state —
 * which the ⋯ menu's trigger needs.
 */
import type { IconName } from '../icon/props.js';

/** Props for the `HeroButton` leaves (web and native). */
export interface HeroButtonProps {
    /** The glyph on the disc. Decorative: the control's name is `label`. */
    readonly icon: IconName;
    /** The control's accessible name, localised by the caller. ⛔ Never a bare "Back" or "More". */
    readonly label: string;
    /** Called on a press (on web, on a plain click of a link). */
    readonly onPress: () => void;
    /** Web: where the control goes. With one it is a real link; without, a button. Native ignores it. */
    readonly href?: string;
    /** Whether the control opens something that is open now. Absent for a control that opens nothing. */
    readonly expanded?: boolean;
    /** Opens nothing and says so. */
    readonly disabled?: boolean;
}
