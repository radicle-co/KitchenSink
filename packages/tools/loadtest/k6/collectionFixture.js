// Finding a k6 VU's collection fixture on a PERSISTENT pool identity, before creating one.
//
// ⛔ WHY A LOAD SCENARIO MUST FIND BEFORE IT CREATES. The deployed tier's pool identities are stable and
// reused across runs (`src/pool.ts`), and nothing reclaims what a scenario creates as them. A scenario that
// creates a per-owner-CAPPED resource on every run therefore walks each pool user toward the cap one run at a
// time — invisibly, until the run that crosses it. `pullFromSource.load.js` did exactly that with
// collections (`MAX_COLLECTIONS_PER_OWNER` = 50): on run 34782454327 the service answered 18
// `409 COLLECTION_LIMIT_REACHED`, the scenario counted those same 18 as `http_req_failed`, and `abortOnFail`
// stopped it at 30 s having measured neither preview nor commit.
//
// Two tempting repairs are WRONG and are recorded so nobody reaches for them: admitting 409 into the deployed
// `expectedStatuses` hides exactly the precondition failure that left the scenario measuring nothing, and
// raising the cap edits a product rule (REQ-049b) to suit a test.
//
// ⚠️ Plain k6-compatible JavaScript with NO k6 import, so it runs under both the k6 binary and vitest
// (`__tests__/collectionFixture.test.ts`). k6 resolves modules on the filesystem, which is why a recipe
// scenario reaches it by relative path, the same way it reaches `session.js`.

/**
 * The reusable source + clone pair named `name` in one owner's collection listing.
 *
 * A SOURCE is a collection with that exact name and no `sourceCollectionId`; its CLONE is a collection with the
 * same name whose `sourceCollectionId` is that source's id (`cloneCollection` copies the source's name). A
 * source that already has a clone is preferred, so a library holding leftovers from earlier runs stops growing
 * rather than gaining a clone per run. The listing is newest-first, so the newest usable pair wins. Pure.
 *
 * ⚠️ Matching is EXACT. Two VUs can drive the same pool user (`Pull load source 1` and `Pull load source 11`),
 * and adopting a sibling's collection would put two VUs' commits on one clone.
 *
 * @param {unknown} body - The parsed `GET /api/v1/collections` response.
 * @param {string} name - The fixture's name.
 * @returns {{ sourceId: string | null, cloneId: string | null }} The ids to reuse; `null` for a half to create.
 * @throws {Error} When the body carries no `data` array — reading that as an empty library would create past the cap.
 */
export function reusableClonePair(body, name) {
    const rows = body !== null && typeof body === 'object' ? body.data : undefined;

    if (!Array.isArray(rows)) {
        throw new Error('collectionFixture: the collection listing has no data array, so reuse cannot be decided');
    }

    const named = rows.filter((row) => row !== null && typeof row === 'object' && row.name === name);
    const sources = named.filter((row) => typeof row.sourceCollectionId !== 'string');
    const cloneOf = (source) => named.find((row) => row.sourceCollectionId === source.id);
    const paired = sources.find((source) => cloneOf(source) !== undefined);

    if (paired !== undefined) {
        return { sourceId: paired.id, cloneId: cloneOf(paired).id };
    }

    return { sourceId: sources[0]?.id ?? null, cloneId: null };
}
