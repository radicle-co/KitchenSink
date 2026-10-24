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
};
