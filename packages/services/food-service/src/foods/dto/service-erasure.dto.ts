/**
 * Response DTO for the food service-principal erasure route `POST /api/v1/internal/account/erasure`
 * (CR-002 / U4b / R11).
 *
 * There is NO request body — the target owner is bound in the verified token, never supplied. The response
 * surfaces the erased requester key and how many `fetch_requesters` rows were removed; the row count is the
 * RESIDUE SIGNAL the erasure-reconciliation sweep reads (a re-drive that deletes `> 0` rows means the leg
 * had not previously completed). An owner with no food footprint is an idempotent no-op: `0` rows.
 */
export interface FoodServiceErasureAcceptedResponse {
    /** The erased requester key — the bound app-user ULID (echoed from the verified token). */
    readonly requesterId: string;
    /** The number of `fetch_requesters` rows removed (0 when there was no footprint / already erased). */
    readonly deletedRequesterRows: number;
}
