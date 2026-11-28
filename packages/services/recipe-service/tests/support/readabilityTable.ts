/** One recipe state, and who reads it. */
export interface ReadabilityRow {
    readonly label: string;
    readonly visibility: 'public' | 'private';
    readonly status: 'published' | 'draft';
    /** Held from readers (ADR-0105): a recipe with cook-captured book evidence. */
    readonly held: boolean;
    /** Tombstoned (`deleted_at` set). */
    readonly deleted: boolean;
    /** Whether the OWNER reads it (scope all). */
    readonly ownerReads: boolean;
    /** Whether another cook reads it (scope all, and Discover's community scope). */
    readonly otherReads: boolean;
}

/**
 * The ONE literal readability table for ADR-0105: every row is a recipe state and, written by hand, who reads it. The unit
 * test of `isRecipeViewableBy` and the LOCAL e2e of the real `readableBy` / `communityOf` both consume it, so the two rule
 * forms are held to the same answers. No expected value is derived. It holds all 16 combinations of visibility, status, held and deleted.
 */
export const READABILITY_TABLE: readonly ReadabilityRow[] = [
    {
        label: 'pubClean',
        visibility: 'public',
        status: 'published',
        held: false,
        deleted: false,
        ownerReads: true,
        otherReads: true,
    },
    {
        label: 'pubHeld',
        visibility: 'public',
        status: 'published',
        held: true,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'privClean',
        visibility: 'private',
        status: 'published',
        held: false,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'privHeld',
        visibility: 'private',
        status: 'published',
        held: true,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'draftPubClean',
        visibility: 'public',
        status: 'draft',
        held: false,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'draftPubHeld',
        visibility: 'public',
        status: 'draft',
        held: true,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'pubCleanDeleted',
        visibility: 'public',
        status: 'published',
        held: false,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'pubHeldDeleted',
        visibility: 'public',
        status: 'published',
        held: true,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'privDraftClean',
        visibility: 'private',
        status: 'draft',
        held: false,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'privDraftHeld',
        visibility: 'private',
        status: 'draft',
        held: true,
        deleted: false,
        ownerReads: true,
        otherReads: false,
    },
    {
        label: 'privCleanDeleted',
        visibility: 'private',
        status: 'published',
        held: false,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'privHeldDeleted',
        visibility: 'private',
        status: 'published',
        held: true,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'privDraftCleanDeleted',
        visibility: 'private',
        status: 'draft',
        held: false,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'privDraftHeldDeleted',
        visibility: 'private',
        status: 'draft',
        held: true,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'draftPubCleanDeleted',
        visibility: 'public',
        status: 'draft',
        held: false,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
    {
        label: 'draftPubHeldDeleted',
        visibility: 'public',
        status: 'draft',
        held: true,
        deleted: true,
        ownerReads: false,
        otherReads: false,
    },
];
