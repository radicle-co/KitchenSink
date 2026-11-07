/**
 * @module cards/uncarded — the surface names that deliberately have no component card, each with its reason.
 *
 * Every other discovered component needs a card (`content/designSystem/cards/<Name>/`); `tests/sourceParity` fails on a
 * component with neither a card nor an entry here, and on an entry here that no longer needs one, so this list cannot
 * grow by accident or outlive its reason.
 *
 * @pattern Registry — a typed table of exceptions, so "no card" is a decision with a stated reason.
 */

/** Surface name to why it has no card. */
export const UNCARDED: Readonly<Record<string, string>> = {
    HeaderEyebrowBack:
        'The "‹ {parent}" eyebrow Back is a part of the large title header, not a component a screen places: on web it shows only from 840 px and is display: none below, and on native it renders nothing because the pinned bar owns Back. The LargeTitleHeader card covers the header it belongs to.',
    SafeAreaProvider:
        "Artifact-only native component (a shim over react-native-safe-area-context) that the canvas boards mount to place a screen inside an iPhone's insets. It draws nothing of its own, so a preview would be an empty box.",
    ScrollFrame:
        'Artifact-only native component: the native ScrollHost with plain children, for canvas markup that cannot pass a render-prop child. It is a board device and not a product component, and the product component it wraps (ScrollHost) has the card.',
    ButtonLabel:
        "The native Button's label (the Text `cardTitle` role coloured by the Button's surface). A part of Button, never placed on its own; the Button card covers it.",
    DesignSystemProvider:
        'Native-only Tamagui provider the app mounts once. It draws nothing of its own and is not placed by a screen; previews are themed by the `data-theme` attribute.',
    DesignSystemTheme:
        'Native-only Tamagui provider in a given scheme, reached through DesignSystemProvider. It draws nothing of its own, so a preview would be an empty box.',
    DialogActions:
        'The action row of a dialog or sheet, placed inside DialogFrame and the sheets and measuring the box it sits in.',
    DialogEngine:
        "Native-only engine of the centred dialog's card (Tamagui's Dialog inside the host's window). Screens place DialogFrame, which the DialogFrame card covers.",
    KeyboardLift:
        "Native-only frame that lifts the Sheet's content above the keyboard. It has no look of its own and is placed only by the Sheet's engine.",
    LiveRegionText:
        'The text of a LiveRegion that names a type role, held out of the layout flow when empty. A part of LiveRegion, which has the card.',
    OverlayHost:
        'Native-only window every sheet and dialog opens in, and the one door their dismissals use. It draws no component of its own: a scrim and the content it is given.',
    OverlayView:
        'Native-only root view of a window overlay that hears the screen-reader escape gesture. It styles nothing, so a preview would be an empty box.',
    Photo: "Native-only photo primitive (Tamagui over expo-image) with no web sibling: the web leaves draw their photos with an img. Its image is the content a caller passes, so a card would only preview a caller's picture.",
    PinnedSearchOverlay:
        'Native-only half of the pinned search: the field drawn once above a list over a spacer the list holds. It needs a host scroll offset to move, so a static preview cannot show it.',
    PinnedSearchSpacer:
        'Native-only slot the list header holds for the pinned field, with its screen-reader stand-in. It draws nothing visible.',
    ScrollChevron:
        "The scroll hint's chevron, a part of HorizontalScroller on native that Tamagui cannot draw yet. The HorizontalScroller card covers it.",
    ScrollFade:
        "The scroll hint's gradient fade, a part of HorizontalScroller on native that Tamagui cannot draw yet. The HorizontalScroller card covers it.",
    SheetEngine:
        "Native-only engine of the Sheet (Tamagui's Sheet inside the host's window). Screens place Sheet, which the Sheet card covers.",
    Text: "Native-only text primitive with no web sibling: web sets type with Tailwind's role utilities. A screen names a type role, and the roles are defined in `typography.ts`.",
    ToneScope:
        "Native-only scope that states a surface's tone to Tamagui's theme and to the JS tone context. It draws nothing of its own; Surface and every self-painting root state their tone through it.",
};
