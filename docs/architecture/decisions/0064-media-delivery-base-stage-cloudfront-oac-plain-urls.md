# 0064 — Media delivery: base-stage CloudFront with OAC, plain public URLs

- **Status:** Accepted
- **Date:** 2026-10-16
- **Relates to:** [ADR-0002](0002-vpc-consolidation-and-cidr-scheme.md) — the distribution lives in the data stack, whose RDS and
  bucket logical ids must not change. [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) and
  [ADR-0061](0061-midnight-stop-reclaims-what-nothing-uses.md) — what teardown may delete. [ADR-0013](0013-cdk-nag-advisory-iac-security-linting.md)
  — the lint findings the new distribution adds. [ADR-0014](0014-service-owned-api-contracts.md) — the avatar wire contract moves.
  [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md) — its "CloudFront is prod-only" rule does not apply here, for the reason in
  decision 3. [ADR-0033](0033-sandbox-previews-on-per-pr-subdomains.md) — the preview names the bucket CORS rule must admit.
  [ADR-0047](0047-shared-cors-policy.md) — the upload origins come from the same `azp` authority.

## Context

Owner rulings, 2026-10-16: **"Avatars public"**, and **"Plain cdn for every photo"** — no signed URLs, no signing key, no expiry
window. In the owner's words: "we just serve them from s3 with the cdn in front of it - s3 is literally designed for this".

Four defects made every stored photo and avatar unusable:

- The media bucket has no CORS configuration, so a browser `PUT` to a presigned upload URL fails its preflight. Mobile `fetch`
  performs no CORS check, so only the web upload is blocked.
- Block Public Access is on and nothing grants a read, so a stored or served photo URL is refused everywhere.
- Identity presigned with a default `S3Client`. The installed SDK signs `x-amz-checksum-crc32` and
  `x-amz-sdk-checksum-algorithm` into the query, a plain HTTP `PUT` cannot reproduce them, and S3 answers `400`. No `avatars/`
  object has ever been written, from any client. The recipe service already documents and avoids this.
- The recipe service built photo URLs from `https://recipe-cdn.${domainName}`, a host that does not exist. The recipe workers'
  distribution id was optional on the premise that no distribution exists, so their invalidation never ran.

Facts the design rests on:

- Keys are write-once. Recipe photos use a UUID and avatars use `avatars/{userId}/{timestamp}.{ext}`, so a long cache lifetime
  cannot serve stale bytes.
- The media bucket is versioned. A delete only adds a marker, and the older version stays recoverable.
- `kitchensink-data-{stage}` is listed as never reclaimed by `sandboxSharedTier.sh`.
- Previews share the sandbox platform, so they share its media bucket.

## Decision

**1. One CloudFront distribution per base stage (`prod`, `sandbox`), owned by the data stack.** It owns the bucket policy, so
it must own the grant to the distribution. The construct is `addMediaDelivery` (`packages/infra/global/lib/platform/mediaDelivery.ts`),
a function and not a `Construct` subclass, because the infrastructure manifest reads every `new X(...)` of a relative import as a
child stack and the deploy gate refuses a stack whose name it cannot read. The distribution reads the bucket through Origin Access
Control. The bucket policy grants exactly `s3:GetObject` to `cloudfront.amazonaws.com`, conditioned on `AWS:SourceArn` being this
distribution, and never `s3:GetObjectVersion`. Block Public Access stays `BLOCK_ALL`.

**2. Plain, unsigned URLs.** One behaviour covers the whole bucket, with no key group and no trusted signer. The cache key is the
path alone: no query string, header or cookie. The cache lifetime is one year. A response-headers policy sets `nosniff` and
`Cache-Control: public, max-age=31536000, immutable`. A `403` or `404` is cached for ten seconds, so an object written just after a
miss is not hidden. The price class is the cheapest, HTTP/2 and HTTP/3 are on, and the minimum TLS version is `TLSv1_2_2021`.

**3. A base-stage distribution in the data stack is outside ADR-0020's premise.** That rule keeps CloudFront prod-only because a
distribution takes minutes to create and must be disabled before deletion, which cannot fit a `pr-{N}` preview's lifetime. This
distribution is not per preview. It lives in `kitchensink-data-{stage}`, which teardown never deletes, so ADR-0061 never removes it,
and previews use the sandbox distribution.

**4. Names.** Production is `media.commise.app`. Sandbox is `media-sandbox.commise.app`, a single label on purpose: it must not
overlap the sandbox router's `*.sandbox.commise.app` alias, and the exact-label `pr-{N}` scope in `previewDomainScope.ts` cannot
match it. The certificate is the existing apex wildcard in us-east-1, taken from the domain stack by reference. A and AAAA alias
records are written in the same stack.

**5. Publication is SSM, never a CloudFormation export.** The data stack writes `cdn-url`, `distribution-id` and
`distribution-arn` under `/kitchensink/{baseStage}/media/`. Services read them at deploy time. An export would put the data stack
in ADR-0002's export-in-use position, where the distribution could never be replaced while any service imports it. A guard
(`mediaCdnFromSsm.test.ts`) pins that no service stack spells a CDN host or imports a media export.

**6. Bucket CORS admits a browser `PUT` and nothing else.** The one rule allows `PUT`, only the `Content-Type` header, no
credentials, and the shared preflight max-age (`PREFLIGHT_MAX_AGE_SECONDS`, one constant exported by `@kitchensink/clerk-verify`).
The allowed origins come from the pure `resolveUploadOrigins`, which derives them from `resolveAzpEnforcement`, the same resolver
the token check and the CORS policy use. An exact party list is admitted as is. A preview pattern becomes `https://pr-*.{base}`
and, in transition mode, also `https://{base}`. With nothing configured it throws, so a synth never produces an empty rule or a
wildcard. S3 allows one `*` per origin and it matches dots too, so `pr-*.{base}` also matches `pr-evil.com.{base}`; that is
accepted because every match still ends in a zone this project owns, credentials are off, and the presigned signature, not the
origin, authorizes the write. It is a separate function from `resolveCorsPolicy` because that call is how the bearer-only guard
finds service adopters.

**7. Erased photos are really gone.** Versioning stays on, and a lifecycle rule expires noncurrent versions after one day and
removes expired delete markers. Without it, a deleted object stays recoverable in the bucket.

**8. URLs are composed at read time from a stored key.** The recipe service already stores keys and composes them with
`resolveCdnUrl`; its base now comes from `MEDIA_CDN_URL`, required on a deployed task and, locally, the unsigned LocalStack bucket in
path style. Identity stores the key too: `profiles.avatar_key`, with a check that it never coexists with `avatar_url` (which keeps
Clerk's picture only) and a check that it lies under the owner's own prefix. The wire contract moves: presign answers
`{ uploadUrl, key }`, `PATCH /users/me` takes `avatarKey` (the service checks ownership with the pure `isOwnAvatarKey`, then a
`HEAD`), and the response `avatarUrl` is composed by the pure `composeAvatarUrl`. A real Clerk picture change clears the key.

**9. Removal is finished only when the edge is purged.** Replacing or clearing an avatar deletes the other objects under the user's
prefix and invalidates `/avatars/{id}/*`, best effort and logged. Erasure removes the objects and requires the invalidation
before the identity row is erased, so a failure makes the request fail and retry. The recipe workers' erasure worker and orphan
sweeper throw on a deployed stage without the distribution id, before any destructive work. Identity keeps its own one-method
`CdnInvalidationPort` rather than importing the recipe domain package, which would put a recipe dependency in identity's source
and container image.

**10. The presigning client asks for checksums only when an operation requires them.** `requestChecksumCalculation:
'WHEN_REQUIRED'`, in a storage adapter, and the dev bucket default is removed so a missing bucket fails closed.

## Consequences

- The deploy order is global, then identity and recipe, then clients. A service deployed before the global app fails its deploy
  on the missing parameter, which is the intended loud failure.
- Merging is a production data-stack deploy. The change set is additions (distribution, cache and headers policies, access control,
  two alias records, three parameters) plus two in-place changes to the existing media bucket (the CORS rule and the lifecycle rule)
  and its policy. The RDS instance and both buckets keep their logical ids, which a test pins. The lifecycle rule, which makes
  noncurrent versions expire, needs the owner's explicit approval for the production deploy.
- The accepted risk: the URL of a private recipe's photo works for anyone who has it, indefinitely. An unguessable key is the only
  barrier, and the owner has ruled that acceptable. A signed scheme would add a signing key, an expiry and a rotation story; none
  is built.
- The global synth now needs the Clerk `azp` settings. The deploy workflows export them from SSM through `exportClerkAzp.sh`, and
  a guard asserts every workflow that synthesizes the global app does so before its first synth.
- `AwsSolutions-CFR1`, `CFR2` and `CFR3` report against the new distribution and are not suppressed. The suppression register lives
  in `@radicle-co/infra-shared`, so a new key is a change to that package; ADR-0013's census counts them instead.
- A year-long cache plus write-once keys means a replaced avatar appears at a new URL immediately; the invalidation exists to
  remove the old object from the edge, not to publish the new one.
- The mobile avatar upload sends the key, and previews the picked file while the save runs. The web avatar control is not part of
  this decision.
