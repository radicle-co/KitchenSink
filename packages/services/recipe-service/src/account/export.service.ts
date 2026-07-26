/**
 * GDPR data-subject ACCESS/PORTABILITY orchestration for `GET /v1/account/export` (Art. 15 + Art. 20).
 *
 * The read-only mirror of {@link ErasureService}: where erasure enqueues a job that hard-deletes every
 * owner-scoped root, this assembles those SAME roots into one structured document. It sits between the
 * controller (which supplies the VERIFIED owner key — never a client-supplied one) and the
 * {@link AccountExportDal}, and owns exactly one responsibility the DAL and mappers do not: composing the
 * seven owner-scoped reads into the single {@link AccountExport} contract.
 *
 * The reads are independent, so they are issued concurrently with `Promise.all` rather than serially —
 * the export touches six tables and there is no ordering dependency between them. The transformation of
 * each result set is delegated to the pure mappers in `export.mappers.ts`, keeping this class a thin,
 * side-effect-only assembler.
 */
import { Inject, Injectable } from '@nestjs/common';

import { AccountExportDal } from './dal/export.dal.js';
import { mapAuthorHandle, mapCollection, mapPhoto, mapRating, mapRecipe, mapVersion } from './export.mappers.js';
import type { AccountExport } from './dto/export.dto.js';

/** DI token for the {@link AccountExportConfig} (the CDN base URL photo keys resolve against). */
export const ACCOUNT_EXPORT_CONFIG = 'ACCOUNT_EXPORT_CONFIG';

/** Configuration the export service needs: the CDN base URL used to resolve photo object keys to URLs. */
export interface AccountExportConfig {
    /** The CloudFront base URL (`CLOUDFRONT_URL`) photo/thumbnail keys are resolved against. */
    readonly cloudfrontUrl: string;
}

@Injectable()
export class AccountExportService {
    public constructor(
        private readonly dal: AccountExportDal,
        @Inject(ACCOUNT_EXPORT_CONFIG) private readonly config: AccountExportConfig,
    ) {}

    /**
     * Assemble the caller's complete recipe-domain personal-data export.
     *
     * @param ownerId - The VERIFIED app-user ULID from the session token. Never client-supplied: it is the
     *   only thing scoping the export, so accepting it from the request would let any caller read another
     *   user's data (account-takeover-grade IDOR). This is the exact inverse of erasure's owner rule.
     * @returns The structured {@link AccountExport} document, stamped with the generation time and owner.
     * @sideEffect Reads the owner's `recipes`, `collections`, `recipe_collections`, `recipe_ratings`,
     *   `recipe_photos`, `recipe_versions`, and `author_handles` rows.
     */
    public async exportForOwner(ownerId: string): Promise<AccountExport> {
        const [recipeRows, collectionRows, membershipRows, ratingRows, photoRows, versionRows, authorHandleRows] =
            await Promise.all([
                this.dal.listRecipes(ownerId),
                this.dal.listCollections(ownerId),
                this.dal.listCollectionMemberships(ownerId),
                this.dal.listRatings(ownerId),
                this.dal.listPhotos(ownerId),
                this.dal.listVersions(ownerId),
                this.dal.listAuthorHandles(ownerId),
            ]);

        return {
            exportedAt: new Date().toISOString(),
            ownerId,
            recipes: recipeRows.map(mapRecipe),
            collections: collectionRows.map((collection) => mapCollection(collection, membershipRows)),
            ratings: ratingRows.map(mapRating),
            photos: photoRows.map((photo) => mapPhoto(photo, this.config.cloudfrontUrl)),
            versions: versionRows.map(mapVersion),
            authorHandles: authorHandleRows.map(mapAuthorHandle),
        };
    }
}
