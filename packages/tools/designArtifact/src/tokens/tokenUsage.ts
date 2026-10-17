/**
 * @module tokens/tokenUsage — what each token is FOR, in a sentence, for the Design System artifact.
 *
 * @pattern Registry — closed records keyed by `@commise/ui`'s own role names. A role added there without a note
 * here fails the typecheck, so the published system cannot gain an undocumented colour or type style.
 *
 * Notes state the job, not a measurement. A contrast ratio written here would go stale the day a colour moved.
 */
import type { palette, role } from '@commise/ui/colors';
import type { spacing } from '@commise/ui/scale';
import type { TypeRole } from '@commise/ui/tokens/typography';

/** A colour role's name, taken from the product. */
type Role = keyof typeof role;

/** A palette tone the artifact lists as a brand tone. The rest are reachable only through a role. */
export type BrandTone = Exclude<keyof typeof palette, 'slate' | 'mist' | 'pearl' | 'white' | 'pewter'>;

/** The group a type style is filed under. */
export type TypeGroupName = 'Display' | 'Headings' | 'Text';

/** What the artifact says about one type role. */
export interface TypeRoleDoc {
    readonly group: TypeGroupName;
    readonly usage: string;
}

/** What each colour role is for. */
export const ROLE_USAGE: Readonly<Record<Role, string>> = {
    canvas: 'Page background.',
    paper: 'Cards and panels on the page.',
    paperRaised: 'A surface lifted above paper.',
    paperOverlay: 'Sheets, menus and dialogs.',
    surfaceMuted: 'Quiet wells and grouped rows.',
    ink: 'Primary text. Never alpha-dimmed.',
    inkMuted: 'Secondary text.',
    lineControl: 'Edge of an input, chip or secondary button.',
    lineDivider: 'Hairline dividers only. Never text, never a control edge.',
    action: 'Fill of the one primary call to action. Carries a white label.',
    actionText: 'Teal used as text or an icon on a light surface.',
    actionPressed: 'Pressed end of the action fill.',
    onAction: 'Label on an action fill.',
    selectedFill: 'Fill of a selected chip or row.',
    selectedEdge: 'Edge of a selected chip or row.',
    hereBar: 'Marks the current place in navigation.',
    focusRing: 'Keyboard focus ring.',
    rating: 'Filled star. A graphic, never text.',
    attention: 'Caution text.',
    attentionTint: 'Caution surface under ink or attention text.',
    danger: 'Destructive fill. Carries a white label.',
    dangerText: 'Error copy and destructive labels.',
    inverse: 'Surface that flips the theme, such as a toast.',
    inverseInk: 'Text on inverse.',
    inverseAction: 'Action colour on inverse.',
    photoChip: 'Chip floating over a photo.',
    scrim: 'Backdrop behind a modal.',
};

/** What the colour tokens that are not roles are for. */
export const EXTRA_COLOR_USAGE = {
    bar: 'Translucent top and bottom bars.',
    proFill: 'Premium badge fill.',
    proInk: 'Label on the premium badge.',
    cover: 'Tinted recipe-cover ground behind a placeholder.',
} as const;

/** What each brand tone is for. */
export const BRAND_USAGE: Readonly<Record<BrandTone, string>> = {
    seafoam: 'Brand teal. Accent, fill, border.',
    'seafoam-light': 'Light teal. Accent only, never a fill under white text.',
    'ocean-dark': 'Dark teal for text on light surfaces.',
    coral: 'Warm accent. Carries a charcoal label.',
    sky: 'Cool accent. Carries a charcoal label.',
    sand: 'Warm page tone.',
    charcoal: 'Deep ink.',
    success: 'Positive state fill.',
    warning: 'Caution fill. Not text.',
    'warning-dark': 'Caution text.',
    error: 'Destructive fill.',
    'error-dark': 'Error text.',
    premium: 'Premium accent.',
    honey: 'Star tone.',
};

/** Group and usage of each type role. `figureInline` takes the size of its line, so it has a note but no style. */
export const TYPE_ROLE_DOC: Readonly<Record<TypeRole, TypeRoleDoc>> = {
    largeTitle: { group: 'Display', usage: 'Page title. Its size follows the width of the page.' },
    barTitle: { group: 'Headings', usage: 'Top bar title.' },
    sectionTitle: { group: 'Headings', usage: 'Section title.' },
    cardTitle: { group: 'Headings', usage: 'Card title.' },
    body: { group: 'Text', usage: 'Default text.' },
    readingBody: { group: 'Text', usage: 'Long-form recipe method text.' },
    meta: { group: 'Text', usage: 'Metadata line.' },
    label: { group: 'Text', usage: 'Control label.' },
    caption: { group: 'Text', usage: 'Caption.' },
    overline: { group: 'Text', usage: 'Overline, set in capitals with wide tracking.' },
    figureInline: { group: 'Text', usage: 'A number inside a line, set in tabular figures.' },
    figureStat: { group: 'Text', usage: 'Statistic figure.' },
};

/** The groups, in the order the artifact lists them. */
export const TYPE_GROUP_ORDER: readonly TypeGroupName[] = ['Display', 'Headings', 'Text'];

/** A scale's notes: one for every step, and the steps that say something more. */
export interface ScaleUsage<Step extends string> {
    readonly fallback: string;
    readonly byStep: Readonly<Partial<Record<Step, string>>>;
}

/** What the spacing steps are for. */
export const SPACING_USAGE: ScaleUsage<`${keyof typeof spacing}`> = {
    fallback: '4px-base step.',
    byStep: { '4': 'Group gap and card padding.' },
};

/** What the radius steps are for. */
export const RADIUS_USAGE: ScaleUsage<'full'> = {
    fallback: 'Corner radius step.',
    byStep: { full: 'Pills, chips and the FAB. Only pressable controls are pills.' },
};

/** What the shadow steps are for. */
export const SHADOW_USAGE: ScaleUsage<'glow'> = {
    fallback: 'Elevation step.',
    byStep: { glow: 'Seafoam halo.' },
};
