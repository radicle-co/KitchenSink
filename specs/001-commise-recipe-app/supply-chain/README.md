# Supply-chain readiness — feature 001-commise-recipe-app

> Produced by Product Forge Phase 9 (release-readiness), 2026-07-16.
> **Status: tools not installed in this environment → gated as MUST action items, not run.**
> Per the release-readiness graceful-degradation rule, a missing tool becomes an
> action item and never silently passes as "clean".

## Tool availability (this environment)

| Carrier           | Tool                                  | Present? | Result                                                                                            |
| ----------------- | ------------------------------------- | :------: | ------------------------------------------------------------------------------------------------- |
| SBOM              | `syft` (CycloneDX)                    |    ❌    | ACTION ITEM (MUST) — generate `sbom.cdx.json` in CI before ship                                   |
| SCA (vulns)       | `osv-scanner` (PR-diff mode)          |    ❌    | ACTION ITEM (MUST) — run `google/osv-scanner-action` PR workflow; block only on NEW high/critical |
| License allowlist | `osv-scanner --experimental-licenses` |    ❌    | ACTION ITEM (MUST) — check new deps against the SPDX allowlist                                    |
| Build provenance  | `actions/attest-build-provenance`     | n/a (CI) | SHOULD — confirm/add the attest step in the release workflow                                      |

## New third-party production dependencies this feature introduces (SCA scope)

These are the delta the SCA gate must scrutinise (pre-existing deps are out of the
delta-philosophy scope):

- `sharp@^0.34.5` — thumbnail generation (recipe-service). **Native binary** — also
  confirm the install arch matches the Fargate task arch (see release-readiness.md;
  the pipeline degrades to serving the original image on arch mismatch).
- `@aws-sdk/client-sqs@^3.935.0` — erasure + version-archive queue producers.
- `@aws-sdk/client-s3@^3.935.0` — photo/version object storage.
- `@aws-sdk/rds-signer@^3.935.0` — IAM DB auth for the VPC workers.

## Recommended CI wiring (before or at merge)

```yaml
# .github/workflows — add to the PR pipeline (PR-diff mode: only NEW high/critical block)
- uses: google/osv-scanner-action/osv-scanner-action@v2
  with: { scan-args: '--recursive ./' }
# SBOM (release job):
- run: syft . -o cyclonedx-json=sbom.cdx.json
- uses: actions/attest-build-provenance@v2
  with: { subject-path: 'dist/**' }
```

## Verdict contribution

No NEW critical/high CVE is _known_ (the scan did not run here), so this does **not**
block on a found vulnerability — it blocks on **tool absence** as a MUST action item.
Once `osv-scanner` runs green in CI over the four new deps above, this carrier clears.
