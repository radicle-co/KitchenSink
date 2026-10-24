// Reading how many analytics events an ingest batch actually LANDED, from the door's `202` body.
//
// ⛔ WHY A LOAD SCENARIO COUNTS LANDINGS, NOT ONLY STATUSES. `POST /ingest/v1/events` answers `202
// { accepted, landed }`, and `landed: 0` is a legitimate answer twice over: a batch SHED by the per-instance
// in-flight bound (KTD4), and a batch from a test principal the stage contains (ADR-0040 — analytics is prevented
// at the capture seam). A scenario that checked only for `202` therefore passed while storing nothing at all. The
// counter this feeds is thresholded on `count>0`: individual shed batches still pass, a run that landed nothing
// fails.
//
// ⚠️ Plain k6-compatible JavaScript with NO k6 import, so it runs under both the k6 binary and vitest
// (`__tests__/ingestLanding.test.ts`). A recipe scenario reaches it by relative path, as it reaches `session.js`.

/**
 * The landed count an ingest response body reports.
 *
 * @param {string | null | undefined} body - The raw response body.
 * @returns {number | null} The non-negative integer `landed`, or `null` when the body is not a landing report —
 *   never a guess, so a malformed answer is never counted as a landing.
 */
export function landedEvents(body) {
    let parsed;

    try {
        parsed = JSON.parse(body ?? '');
    } catch {
        return null;
    }

    const landed = parsed !== null && typeof parsed === 'object' ? parsed.landed : undefined;

    return Number.isInteger(landed) && landed >= 0 ? landed : null;
}
