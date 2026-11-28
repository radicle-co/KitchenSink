/**
 * LABELLED_NAMES: every internal name a person reads, with the shapes of its key and who sees it (4.4, 4.8, 4.9). The
 * messages file in `@commise/features-recipes` is typed by it, so a missing key is a compile error. Strings never go
 * here: the backend shares this package.
 *
 * A shape is a suffix on the name's key. `''` is the bare name, so `ORIGIN_WEB_PAGE` has the keys `ORIGIN_WEB_PAGE` and
 * `ORIGIN_WEB_PAGE.withSite`.
 *
 * @pattern Registry typed by a template-literal union, so a name without its key fails the build.
 */

/** Who sees a label. */
export type LabelViewer =
    'owner' | 'reader' | 'both' | 'any' | 'owner (private only)' | 'signed-out reader' | 'signed-in reader';

interface LabelledName {
    readonly shapes: readonly string[];
    readonly viewer: LabelViewer;
}

const OWNER_READER = ['.owner', '.reader'] as const;

export const LABELLED_NAMES = {
    LIFECYCLE_DRAFT: { shapes: [''], viewer: 'owner' },
    AUDIENCE_PRIVATE: { shapes: [''], viewer: 'owner' },
    AUDIENCE_PUBLIC: { shapes: [''], viewer: 'owner' },
    ORIGIN_OWN: { shapes: OWNER_READER, viewer: 'both' },
    ORIGIN_WEB_PAGE: { shapes: ['', '.withSite'], viewer: 'owner (private only)' },
    ORIGIN_BOOK: { shapes: [''], viewer: 'owner (private only)' },
    ORIGIN_PAID_SITE: { shapes: [''], viewer: 'owner (private only)' },
    ORIGIN_PERSON: { shapes: [''], viewer: 'owner (private only)' },
    ORIGIN_PUBLIC_DOMAIN: { shapes: [''], viewer: 'any' },
    ORIGIN_COMMISE_WRITTEN: { shapes: [''], viewer: 'any' },
    VIEW_IN_REVIEW: { shapes: [''], viewer: 'owner' },
    VIEW_CHECKING: { shapes: [''], viewer: 'owner' },
    VIEW_ADAPTED_BY_COOK: {
        // Written out, not built with `flatMap`: a computed list widens to `string` and `LabelKey` stops being checked.
        shapes: [
            ...OWNER_READER,
            '.heading.owner',
            '.heading.reader',
            '.headingNoCitation.book.owner',
            '.headingNoCitation.book.reader',
            '.headingNoCitation.paidSite.owner',
            '.headingNoCitation.paidSite.reader',
            '.headingNoCitation.webPage.owner',
            '.headingNoCitation.webPage.reader',
            '.earnedSentence',
        ],
        viewer: 'both',
    },
    VIEW_COPY_OF: { shapes: [''], viewer: 'both' },
    VIEW_COPY_OF_COMMISE_PAGE: { shapes: [''], viewer: 'both' },
    VIEW_CHANGES_ON_DEVICE: { shapes: [''], viewer: 'owner' },
    VIEW_HIDDEN_AFTER_REPORT: { shapes: OWNER_READER, viewer: 'both' },
    VIEW_HIDDEN: { shapes: [''], viewer: 'owner' },
    VIEW_HIDDEN_REASON: {
        shapes: ['.heldSource', '.tooClose', '.afterCheck', '.notApproved', '.sourceCorrected'],
        viewer: 'owner',
    },
    // The refused-save sheet. Its other lines reuse shipped keys by name (`changesKept`, `waysHeading`, `wayPrivateSave`,
    // `savePrivate`, Discard, `publishBlocked.noSlot.upsell`, `publishBlocked.seePremium`), so none is a shape here.
    VIEW_SAVE_REFUSED: {
        shapes: [
            '.title',
            '.why.heldSource',
            '.why.tooClose',
            '.why.notApproved',
            '.wayRewrite',
            '.wayRewriteAction',
            '.wayDiscard',
            '.wayHide',
            '.wayHideAction',
        ],
        viewer: 'owner',
    },
    VIEW_CARD_CANNOT_STAY_PUBLIC: { shapes: ['.heldSource', '.tooClose', '.sourceCorrected'], viewer: 'owner' },
    VIEW_SAVE_REFUSED_LATE: { shapes: [''], viewer: 'owner' },
    VIEW_DRAFT_DOOR: { shapes: ['.title', '.publishPrivateOnly'], viewer: 'owner' },
    HOLD_REMOVED: { shapes: [''], viewer: 'owner' },
    SOURCE_HEADING: { shapes: [''], viewer: 'any' },
    REPORT_ACTION: { shapes: [''], viewer: 'any' },
    REPORT_SIGN_IN: { shapes: ['.title', '.body'], viewer: 'signed-out reader' },
    REPORT_LIMIT_REACHED: { shapes: [''], viewer: 'signed-in reader' },
    ANSWER_UNSTATED_PRIVATE: { shapes: ['', '.hint'], viewer: 'owner' },
    LABEL_SEPARATOR: { shapes: [''], viewer: 'any' },
} as const satisfies Record<string, LabelledName>;

/** One internal name a person reads. */
export type LabelledNameKey = keyof typeof LABELLED_NAMES;

/** Every message key the registry requires: each name plus each of its shapes. */
export type LabelKey = {
    [N in LabelledNameKey]: `${N}${(typeof LABELLED_NAMES)[N]['shapes'][number]}`;
}[LabelledNameKey];

const ALL_LABEL_KEYS: readonly LabelKey[] = Object.entries(LABELLED_NAMES).flatMap(([name, { shapes }]) =>
    shapes.map((shape) => `${name}${shape}` as LabelKey),
);

/**
 * The message keys of one name, in the order its shapes are written. A name holds no dot, so a key belongs to the name
 * that is the whole key or the text before its first dot.
 *
 * @param name - A labelled name.
 * @returns Its keys. Pure.
 */
export function labelKeysOf(name: LabelledNameKey): readonly LabelKey[] {
    return ALL_LABEL_KEYS.filter((key) => key.split('.', 1)[0] === name);
}
