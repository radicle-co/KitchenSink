/**
 * `AuthoredFoodsDao` (plan U10, D8/D9a/KTD-H) — the write path for USER-AUTHORED foods, and nothing else.
 *
 * DESIGN PATTERN: Repository, deliberately SEPARATE from `FoodDao`: that class is the PIPELINE's writer
 * (dedup-by-name admission, guarded lifecycle transitions, golden-scalar merges), and an authored food
 * follows none of those rules — it is born `RESOLVED`, has no crosswalk row, no candidates, no queue row,
 * and exactly one writer (its author). Mixing the two write disciplines into one class is how the
 * single-writer ruling would erode one convenience method at a time.
 *
 * ## What a created row looks like, structurally (KTD-H)
 *
 *  - `food`: `user_id` = the author, `visibility` = 'private' (Q3c — promotion is U12's), status
 *    `RESOLVED` (there is nothing to resolve; the author IS the source), NO `food_sources` row — which
 *    keeps it out of both refresh scans by construction.
 *  - the nutrition aggregate (0018): one header and the four macro values (Q3a), each UNCITED (0013 made value provenance nullable;
 *    NULL means "the food's author wrote this"). Dictionary identities come from
 *    {@link LABEL_NUTRIENT_MAP} — the SAME `{name, unit}` rows the USDA merge resolves against, so the
 *    recipe side's nutrition projection reads authored macros through the very code path it already has.
 *  - `food_portions`: optional household measures, `source_id` NULL.
 *
 * ## Dedup (KTD-H's per-author partial unique)
 *
 * The database is the authority: `food_normalized_name_per_author_unique` rejects a second row for the
 * same `(normalized_name, user_id)`. This DAO surfaces that as {@link AuthoredCreateResult}'s
 * `duplicate` arm — resolved INSIDE the transaction by re-reading the existing row — rather than letting
 * a 23505 escape as a 500.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import type { FoodTx, FoodWriter } from '../../database/unitOfWork.js';

import { food, foodPortions, foodPublicationRequests, foodVersions } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { FoodNutritionDao, type AuthoredNutritionValue } from './foodNutrition.dao.js';
import { FoodItemDao, itemIdOfFood } from './foodItem.dao.js';
import { NutrientDao } from './nutrient.dao.js';
import { isUniqueViolation } from './dao.errors.js';
import { LABEL_NUTRIENT_MAP } from '../nutrition/labelNutrientMap.js';
import { decideEdit, publicationStateOf, type PublicationState } from '../domain/publicationRequestPolicy.js';

/** The authored macros, per 100g (Q3a: macros-only at launch). */
export interface AuthoredMacrosInput {
    readonly calories: number;
    readonly proteinG: number;
    readonly carbsG: number;
    readonly fatG: number;
}

/** One authored household portion. */
export interface AuthoredPortionRow {
    readonly label: string;
    readonly gramWeight: number;
}

/** Input for {@link AuthoredFoodsDao.createAuthored}. */
export interface CreateAuthoredInput {
    /** The author's app-user ULID. */
    readonly userId: string;
    /** Display name. */
    readonly name: string;
    /** The dedup key (`normalizeName(name)`), computed by the service. */
    readonly normalizedName: string;
    readonly description: string | null;
    readonly macros: AuthoredMacrosInput;
    readonly portions: readonly AuthoredPortionRow[];
}

/** The create outcome: the new id, or the existing row the per-author unique rejected it against. */
export type AuthoredCreateResult =
    { readonly kind: 'created'; readonly id: string } | { readonly kind: 'duplicate'; readonly existingId: string };

/** The two 0013 columns the authorship policy decides over, plus the name for dedup-on-rename. */
export interface AuthorshipFacts {
    readonly userId: string | null;
    readonly visibility: 'public' | 'private' | 'promoted';
}

/** Narrow the 0013 visibility text column; the CHECK makes anything else a defect worth throwing on. Pure. */
export function narrowVisibility(visibility: string): 'public' | 'private' | 'promoted' {
    if (visibility === 'public' || visibility === 'private' || visibility === 'promoted') {
        return visibility;
    }

    throw new Error(`unknown food visibility '${visibility}'`);
}

/** One row of the author's list. */
export interface OwnFoodListItem {
    readonly id: string;
    readonly name: string;
    readonly publicationState: PublicationState;
    /** ISO 8601. */
    readonly updatedAt: string;
}

/** A page of the author's foods, and how many decisions they have not opened. */
export interface OwnFoodList {
    readonly items: OwnFoodListItem[];
    /** Opaque; absent on the last page. */
    readonly nextCursor: string | undefined;
    /** Foods whose newest request was decided and not yet opened by the author. */
    readonly unseenDecisions: number;
}

interface OwnFoodRow extends Record<string, unknown> {
    id: string;
    name: string;
    status: string;
    visibility: string;
    updated_at: Date | string;
    newest_version: number | null;
    request_status: string | null;
    request_version: number | null;
}

/** The cursor is the last row's (updated_at, id), base64url. Pure. */
function encodeCursor(updatedAt: string, id: string): string {
    return Buffer.from(JSON.stringify([updatedAt, id])).toString('base64url');
}

/** Decode a cursor; a malformed one reads as the first page rather than an error. Pure. */
function decodeCursor(cursor: string | undefined): { updatedAt: string; id: string } | undefined {
    if (cursor === undefined) {
        return undefined;
    }

    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

        return Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
            ? { updatedAt: parsed[0], id: parsed[1] }
            : undefined;
    } catch {
        return undefined;
    }
}

/** The four macro rows, in a stable order, resolved to the canonical dictionary identities. */
const MACRO_LABELS = [
    { key: 'calories' as const, identity: LABEL_NUTRIENT_MAP.calories },
    { key: 'proteinG' as const, identity: LABEL_NUTRIENT_MAP.protein },
    { key: 'carbsG' as const, identity: LABEL_NUTRIENT_MAP.carbohydrates },
    { key: 'fatG' as const, identity: LABEL_NUTRIENT_MAP.fat },
];

/** One version row's content — what the food SAYS at this version (R21's recourse shape). Pure. */
function snapshotOf(input: CreateAuthoredInput): Record<string, unknown> {
    return {
        name: input.name,
        description: input.description,
        macros: input.macros,
        portions: input.portions,
    };
}

export class AuthoredFoodsDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * Create an authored food: the row, its four macro values, and its portions, in ONE transaction.
     *
     * @param input - The author, names, macros and portions.
     * @returns `created` with the new id, or `duplicate` with the colliding row's id.
     * @sideEffect Writes `food_item`, `food`, the nutrition aggregate, `food_portions` (and possibly the `nutrient`
     *   dictionary).
     */
    public async createAuthored(input: CreateAuthoredInput): Promise<AuthoredCreateResult> {
        try {
            return await this.db.transaction(async (tx: FoodTx) => {
                // An authored food owns a live item like any root (curated catalog plan KTD-6). It has no source row.
                const id = await new FoodItemDao(tx).insertLiveRoot({
                    name: input.name,
                    normalizedName: input.normalizedName,
                    description: input.description,
                    status: 'RESOLVED',
                    userId: input.userId,
                    visibility: 'private',
                });

                await writeValues(tx, id, input.macros, input.portions);
                // R21/KTD-I: version 1 IS the created content — the history starts at birth, so the
                // recourse trail has no gap between "created" and "first edited".
                await tx.insert(foodVersions).values({
                    foodId: id,
                    versionNumber: 1,
                    snapshot: snapshotOf(input),
                    createdBy: input.userId,
                });

                return { kind: 'created', id };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                // ⛔ `status <> 'WITHDRAWN'` MIRRORS the partial unique index (0017), and the two must not
                // drift. The index stopped seeing withdrawn rows so an author can re-add a name they
                // withdrew; this read is what turns a unique violation into "edit that one instead", so
                // without the same predicate it can hand back the id of a WITHDRAWN food — a row the author
                // cannot edit and did not collide with.
                const existing = await this.db
                    .select({ id: food.id })
                    .from(food)
                    .where(
                        and(
                            eq(food.normalizedName, input.normalizedName),
                            eq(food.userId, input.userId),
                            ne(food.status, 'WITHDRAWN'),
                        ),
                    );
                const existingId = existing[0]?.id;

                if (existingId !== undefined) {
                    return { kind: 'duplicate', existingId };
                }
            }

            throw error;
        }
    }

    /**
     * Replace an authored food's content wholesale (PUT semantics — "the author may edit EVERYTHING").
     *
     * A PRIVATE food's edit rewrites the live row now. A PROMOTED food's edit writes only the next
     * `food_versions` row and opens a pending publication request at it: every reader keeps the approved version
     * until staff approve (ADR-0029 §7). Either way a request already pending is closed and, where the policy says,
     * re-opened at the new version, so staff only ever see the newest one.
     *
     * ⚠️ The caller has ALREADY passed `evaluateAuthorship`; this method re-asserts only the structural
     * facts (`user_id` matches, so a raced delete/erasure loses cleanly with `missing`).
     *
     * @param input - The same shape as create, plus the food id.
     * @returns `missing` when no owned row matched (raced away or withdrawn), `duplicate` on a rename collision,
     *   `replaced` when the live row now says this, `proposed` with the new version number when staff must approve it.
     * @sideEffect Rewrites the live row (private) or only appends a version (promoted); writes request rows.
     */
    public async replaceAuthored(
        input: CreateAuthoredInput & { readonly id: string },
    ): Promise<
        | { readonly kind: 'replaced' }
        | { readonly kind: 'proposed'; readonly versionNumber: number }
        | { readonly kind: 'missing' }
        | { readonly kind: 'duplicate'; readonly existingId: string }
    > {
        try {
            return await this.db.transaction(async (tx: FoodTx) => {
                // The row lock serializes racing edits, so the next version number below cannot collide on the
                // unique, and "was a request pending" is read against a stable row.
                const locked = await tx.execute<{ visibility: string }>(sql`
                    SELECT visibility FROM food
                     WHERE id = ${input.id} AND user_id = ${input.userId} AND status <> 'WITHDRAWN'
                       FOR UPDATE
                `);
                const visibility = locked.rows[0]?.visibility;

                if (visibility === undefined) {
                    return { kind: 'missing' };
                }

                const pending = await tx
                    .select({ id: foodPublicationRequests.id })
                    .from(foodPublicationRequests)
                    .where(
                        and(
                            eq(foodPublicationRequests.foodId, input.id),
                            eq(foodPublicationRequests.status, 'pending'),
                        ),
                    );
                const decision = decideEdit({
                    visibility: narrowVisibility(visibility),
                    hadPending: pending.length > 0,
                });

                if (decision.apply && !(await rewriteLiveRow(tx, input))) {
                    return { kind: 'missing' };
                }

                // R21: EVERY edit versions — a promoted food's included (the ruling's whole point).
                const version = await tx.execute<{ version_number: number }>(sql`
                    INSERT INTO food_versions (food_id, version_number, snapshot, created_by)
                    SELECT ${input.id},
                           COALESCE(MAX(version_number), 0) + 1,
                           ${JSON.stringify(snapshotOf(input))}::jsonb,
                           ${input.userId}
                      FROM food_versions WHERE food_id = ${input.id}
                    RETURNING version_number
                `);
                const versionNumber = version.rows[0]?.version_number;

                if (versionNumber === undefined) {
                    throw new Error('the version insert returned no row');
                }

                if (pending.length > 0) {
                    await tx
                        .update(foodPublicationRequests)
                        .set({ status: 'closed', decidedAt: sql`now()` })
                        .where(
                            and(
                                eq(foodPublicationRequests.foodId, input.id),
                                eq(foodPublicationRequests.status, 'pending'),
                            ),
                        );
                }

                if (decision.openRequest) {
                    await tx
                        .insert(foodPublicationRequests)
                        .values({ foodId: input.id, foodVersionNumber: versionNumber });
                }

                return decision.apply ? { kind: 'replaced' } : { kind: 'proposed', versionNumber };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                // ⛔ `status <> 'WITHDRAWN'` MIRRORS the partial unique index (0017), and the two must not
                // drift. The index stopped seeing withdrawn rows so an author can re-add a name they
                // withdrew; this read is what turns a unique violation into "edit that one instead", so
                // without the same predicate it can hand back the id of a WITHDRAWN food — a row the author
                // cannot edit and did not collide with.
                const existing = await this.db
                    .select({ id: food.id })
                    .from(food)
                    .where(
                        and(
                            eq(food.normalizedName, input.normalizedName),
                            eq(food.userId, input.userId),
                            ne(food.status, 'WITHDRAWN'),
                        ),
                    );
                const existingId = existing[0]?.id;

                if (existingId !== undefined && existingId !== input.id) {
                    return { kind: 'duplicate', existingId };
                }
            }

            throw error;
        }
    }

    /**
     * The author's own foods, newest edit first, each with its publication state (revision 4, F19).
     *
     * The state is derived by the ONE pure `publicationStateOf` from the food and its newest request, so this list and
     * the food page cannot disagree. A food mid-erasure is not listed.
     *
     * @param authorId - The verified caller.
     * @param page - `limit` rows, and the opaque `cursor` of the previous page.
     * @returns The page, its cursor, and the count of decisions the author has not opened.
     * @sideEffect Reads `food`, `food_versions`, `food_publication_requests`.
     */
    public async listOwn(
        authorId: string,
        page: { readonly limit: number; readonly cursor?: string },
    ): Promise<OwnFoodList> {
        const after = decodeCursor(page.cursor);
        const rows = await this.db.execute<OwnFoodRow>(sql`
            SELECT f.id, f.name, f.status, f.visibility, f.updated_at,
                   (SELECT MAX(version_number) FROM food_versions v WHERE v.food_id = f.id) AS newest_version,
                   r.status AS request_status, r.food_version_number AS request_version
              FROM food f
              LEFT JOIN LATERAL (
                  SELECT status, food_version_number FROM food_publication_requests
                   WHERE food_id = f.id ORDER BY created_at DESC, food_version_number DESC LIMIT 1
              ) r ON true
             WHERE f.user_id = ${authorId} AND f.status <> 'DELETING'
               ${after === undefined ? sql`` : sql`AND (f.updated_at, f.id) < (${after.updatedAt}::timestamptz, ${after.id})`}
             ORDER BY f.updated_at DESC, f.id DESC
             LIMIT ${page.limit + 1}
        `);
        const shown = rows.rows.slice(0, page.limit);
        const last = shown[shown.length - 1];
        const items = shown.map((row): OwnFoodListItem => {
            const updatedAt = new Date(row.updated_at).toISOString();

            return {
                id: row.id,
                name: row.name,
                publicationState: publicationStateOf({
                    visibility: narrowVisibility(row.visibility),
                    status: row.status,
                    newestVersion: row.newest_version ?? 0,
                    newestRequest:
                        row.request_status === null || row.request_version === null
                            ? undefined
                            : { status: row.request_status, versionNumber: row.request_version },
                }),
                updatedAt,
            };
        });
        const unseen = await this.db.execute<{ n: number }>(sql`
            SELECT COUNT(*)::int AS n
              FROM food f
              JOIN LATERAL (
                  SELECT status, author_seen_at FROM food_publication_requests
                   WHERE food_id = f.id ORDER BY created_at DESC, food_version_number DESC LIMIT 1
              ) r ON true
             WHERE f.user_id = ${authorId} AND r.status IN ('approved', 'declined') AND r.author_seen_at IS NULL
        `);

        return {
            items,
            nextCursor:
                rows.rows.length > page.limit && last !== undefined
                    ? encodeCursor(new Date(last.updated_at).toISOString(), last.id)
                    : undefined,
            unseenDecisions: unseen.rows[0]?.n ?? 0,
        };
    }

    /**
     * The author opened the food: mark its newest request seen, when that request was decided and is unseen.
     *
     * @param foodId - The food.
     * @param authorId - The verified caller; a food they do not own changes nothing.
     * @sideEffect Updates at most one request row.
     */
    public async markSeen(foodId: string, authorId: string): Promise<void> {
        await this.db.execute(sql`
            UPDATE food_publication_requests r
               SET author_seen_at = now()
             WHERE r.id = (
                       SELECT x.id FROM food_publication_requests x JOIN food f ON f.id = x.food_id
                        WHERE x.food_id = ${foodId} AND f.user_id = ${authorId}
                        ORDER BY x.created_at DESC, x.food_version_number DESC LIMIT 1
                   )
               AND r.status IN ('approved', 'declined')
               AND r.author_seen_at IS NULL
        `);
    }

    /**
     * One food's publication state for the author's food page; the same derivation as the list.
     *
     * @param foodId - The food.
     * @returns The state, or `undefined` when the food does not exist.
     * @sideEffect Reads three tables.
     */
    public async publicationStateFor(foodId: string): Promise<PublicationState | undefined> {
        const rows = await this.db.execute<OwnFoodRow>(sql`
            SELECT f.id, f.name, f.status, f.visibility, f.updated_at,
                   (SELECT MAX(version_number) FROM food_versions v WHERE v.food_id = f.id) AS newest_version,
                   r.status AS request_status, r.food_version_number AS request_version
              FROM food f
              LEFT JOIN LATERAL (
                  SELECT status, food_version_number FROM food_publication_requests
                   WHERE food_id = f.id ORDER BY created_at DESC, food_version_number DESC LIMIT 1
              ) r ON true
             WHERE f.id = ${foodId}
        `);
        const row = rows.rows[0];

        return row === undefined
            ? undefined
            : publicationStateOf({
                  visibility: narrowVisibility(row.visibility),
                  status: row.status,
                  newestVersion: row.newest_version ?? 0,
                  newestRequest:
                      row.request_status === null || row.request_version === null
                          ? undefined
                          : { status: row.request_status, versionNumber: row.request_version },
              });
    }

    /**
     * Close the pending publication request of a food its author withdrew. A no-op when none is pending.
     *
     * @param foodId - The withdrawn food.
     * @sideEffect Updates at most one `food_publication_requests` row.
     */
    public async closePendingRequests(foodId: string): Promise<void> {
        await this.db
            .update(foodPublicationRequests)
            .set({ status: 'closed', decidedAt: sql`now()` })
            .where(and(eq(foodPublicationRequests.foodId, foodId), eq(foodPublicationRequests.status, 'pending')));
    }

    /**
     * The two columns `evaluateAuthorship` decides over, or `undefined` when the food does not exist.
     *
     * @sideEffect Reads `food`.
     */
    public async readAuthorshipFacts(id: string): Promise<AuthorshipFacts | undefined> {
        const rows = await this.db
            .select({ userId: food.userId, visibility: food.visibility })
            .from(food)
            .where(eq(food.id, id));
        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        return { userId: row.userId, visibility: narrowVisibility(row.visibility) };
    }
}

/** The macro + portion writes shared by create, replace and approval. @sideEffect Replaces the values; inserts portions. */
async function writeValues(
    tx: FoodTx,
    foodId: string,
    macros: AuthoredMacrosInput,
    portions: readonly AuthoredPortionRow[],
): Promise<void> {
    // `NutrientDao` takes `FoodWriter`, which an open transaction satisfies structurally — no cast.
    const dictionary = await new NutrientDao(tx).resolveOrCreateMany(
        MACRO_LABELS.map(({ identity }) => ({ name: identity.name, unit: identity.unit })),
    );
    const values: AuthoredNutritionValue[] = MACRO_LABELS.map(({ key }, index) => {
        const row = dictionary[index];

        if (row === undefined) {
            throw new Error(`the nutrient dictionary answered no row for macro ${key}`);
        }

        return { nutrientId: row.id, amount: String(macros[key]) };
    });

    // One header per root (KTD-19); its values are UNCITED, which the assertion trigger admits only because the
    // food is authored (ADR-0029).
    await new FoodNutritionDao(tx).replaceAuthoredValues(foodId, values);

    for (const portion of portions) {
        await tx.insert(foodPortions).values({
            id: newFoodId(),
            itemId: itemIdOfFood(foodId),
            label: portion.label,
            gramWeight: String(portion.gramWeight),
        });
    }
}

/**
 * Rewrite an authored food's LIVE row wholesale: scalars, the author's own portions and the macro values.
 *
 * Shared by an author's edit of a private food and by staff approval, so "the live row now says this version" has one
 * implementation.
 *
 * @param tx - The open transaction.
 * @param input - The content to write, plus the owner the row must match.
 * @returns `false` when no live owned row matched (raced away or withdrawn).
 * @sideEffect Updates `food`; replaces `food_portions` and the nutrition values.
 */
export async function rewriteLiveRow(
    tx: FoodTx,
    input: CreateAuthoredInput & { readonly id: string },
): Promise<boolean> {
    const updated = await tx
        .update(food)
        .set({
            name: input.name,
            normalizedName: input.normalizedName,
            description: input.description,
            updatedAt: sql`now()`,
        })
        // ⛔ The WHERE clause IS the authorization, and it carries the lifecycle too: a withdrawn food is not
        // editable, so zero rows → `missing` → 404. No policy change and no new branch — the same idiom the owner
        // predicate already uses.
        .where(and(eq(food.id, input.id), eq(food.userId, input.userId), ne(food.status, 'WITHDRAWN')))
        .returning({ id: food.id });

    if (updated.length === 0) {
        return false;
    }

    // Full replacement: delete-and-reinsert is the PUT semantics, and both tables are small (≤ 4 macros + ≤ 10
    // portions). The values are replaced by `writeValues`' gateway call.
    await tx
        .delete(foodPortions)
        .where(
            and(
                eq(foodPortions.itemId, itemIdOfFood(input.id)),
                isNull(foodPortions.sourceId),
                isNull(foodPortions.citationId),
            ),
        );
    await writeValues(tx, input.id, input.macros, input.portions);

    return true;
}
