/**
 * Response types for `GET /api/v1/account/export` — the GDPR Art. 15 (access) / Art. 20 (portability) export
 * of the CALLER'S OWN recipe-domain personal data.
 *
 * A re-export of the AUTHORED contract in `../account.schema.ts` (CODING_STANDARDS §15.2), kept as a module so
 * the mappers' and service's existing import path stays valid. The eight hand-written interfaces that used to
 * live here are gone: they were a description of the document with nothing checking it against what the
 * service emits, and `openapi.yaml` could not describe the endpoint at all because there was no zod anywhere.
 * The shapes, the reasoning behind the `null`-not-omitted and `numeric`-stays-a-string decisions, and the
 * suite that parses the service's REAL output all live with the schema now.
 */
export type {
    AccountExport,
    AuthorHandleExport,
    CollectionExport,
    CollectionMembershipExport,
    PhotoExport,
    RatingExport,
    RecipeExport,
    VersionExport,
} from '../account.schema.js';
