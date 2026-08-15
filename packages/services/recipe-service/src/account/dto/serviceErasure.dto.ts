/**
 * Response type for the service-principal erasure route `POST /api/v1/internal/account/erasure` (CR-002 / U4a).
 *
 * A re-export of the AUTHORED contract in `../account.schema.ts` (CODING_STANDARDS §15.2), kept as a module so
 * the vertical's existing import path stays valid.
 *
 * ⚠️ THERE IS NO REQUEST DTO HERE, AND THAT IS THE DESIGN, NOT AN OMISSION. The service path has no request
 * body: the target owner is bound in the verified machine token, so there is no `ownerId` to smuggle, and no
 * confirmation phrase (the token IS the authorization, which is why `ErasureService.requestServiceErasure`
 * skips the phrase the user path requires). Adding a body DTO here would be the first step toward accepting a
 * target from the caller — a contract test asserts the handler has no body parameter.
 */
export type { ServiceErasureAcceptedResponse } from '../account.schema.js';
