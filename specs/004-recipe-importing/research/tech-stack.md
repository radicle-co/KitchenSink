# Tech Stack — 004 Recipe Importing

**Regenerated**: 2026-08-02
**Method**: every package below was verified against the npm registry on 2026-08-02 (existence, current
version, last publish date). Nothing here is asserted from memory.

> **Regeneration note.** The previous plan's primary extraction dependency was `schema-org-js`, which **does
> not exist** — the registry returns 404. It was the foundation of the requirement carrying the 85% accuracy
> criterion, and nothing downstream caught it. Hence the verification discipline in this revision.

## Selected dependencies

| Need                    | Package                        | Version · last publish   | Why this one                                                                |
| ----------------------- | ------------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| HTML parsing/selectors  | `cheerio`                      | 1.2.0 · 2026-07          | Actively maintained; far lighter than a full DOM emulation                  |
| JSON-LD extraction      | _(none — `JSON.parse` + Zod)_  | zod already a dep        | The format needs no library; the **risk** is validation, which Zod covers   |
| Microdata               | `microdata-node`               | 2.0.0 · 2022-06          | Small, focused, frozen format. ⚠️ dormant — see risk below                  |
| Ingredient-line parsing | `parse-ingredient`             | 2.2.0 · 2026-04          | Actively maintained; the alternative is dormant since 2022                  |
| ISO-8601 durations      | `iso8601-duration`             | 2.1.4 · 2026-06          | The library-first gate explicitly forbids hand-rolled date math             |
| URL canonicalization    | `normalize-url`                | 9.0.1 · 2026-05          | HAZ-019 is precisely the bug a hand-rolled version produces                 |
| Timeout/retry/breaker   | `cockatiel`                    | 4.0.0 · 2026-05          | TS-native; covers timeout + retry + breaker + bulkhead in one               |
| HTML sanitization       | `sanitize-html`                | 2.17.6 · 2026-07         | Server-side, no DOM required                                                |
| Magic-byte file typing  | `file-type`                    | **already a dependency** | Already in the recipe service; the gate names this explicitly               |
| YAML                    | `yaml`                         | 2.9.0 · 2026             | Maintained successor to `js-yaml`                                           |
| Markdown frontmatter    | `gray-matter`                  | 4.0.3 · 2023-07          | Ubiquitous, stable, frozen format. ⚠️ dormant — see risk below              |
| Private-IP detection    | `ipaddr.js`                    | 2.4.0 · 2026             | Correct CIDR handling incl. IPv6; hand-rolling this is how SSRF guards fail |
| OCR                     | `@aws-sdk/client-textract`     | 3.1101 · 2026-07         | Already an AWS-native stack; IAM rather than a new vendor secret            |
| HTTP client             | `undici` (Node built-in fetch) | runtime                  | Provides the custom dispatcher the SSRF pinning requires                    |

## Deliberately rejected

| Rejected                      | Instead            | Reason                                                           |
| ----------------------------- | ------------------ | ---------------------------------------------------------------- |
| `schema-org-js`               | —                  | **Does not exist.** Registry 404.                                |
| RDFa parsing (any)            | —                  | No maintained Node parser; negligible recipe usage (C-007)       |
| `jsdom`                       | `cheerio`          | Full DOM emulation is far heavier than extraction needs          |
| `recipe-ingredient-parser-v2` | `parse-ingredient` | Dormant since 2022                                               |
| `opossum`                     | `cockatiel`        | Breaker only; we need timeout + retry + bulkhead too             |
| `isomorphic-dompurify`        | `sanitize-html`    | Requires a DOM; unnecessary server-side overhead                 |
| `axios`                       | `undici`           | No need, and undici gives the dispatcher SSRF pinning depends on |
| Tesseract (self-hosted)       | Textract           | Container + model operations we don't want to own                |
| Google Cloud Vision           | Textract           | A second cloud vendor and a second credential path               |

## Dependency risk — stated, not buried

`microdata-node` (2022) and `gray-matter` (2023) fall short of "actively maintained". Both are accepted on the
grounds that they parse **frozen formats**, are small and focused, sit behind ports (so replacement is local),
and produce output that is Zod-validated and sanitized before use — so neither is on a trust boundary.

This is recorded as an open finding (`MIN-006` in `../v-model/peer-review.md`) to be re-evaluated at
implementation time rather than quietly accepted.

## Platform stack (unchanged, inherited)

NestJS 11 · Drizzle ORM · PostgreSQL 16 · Zod 4 · class-validator (DTOs) · Next.js 15 / React 19 · Expo 57 /
RN 0.86 · Vitest · Playwright · Maestro · k6 · Stryker · AWS ECS Fargate + S3 + SQS behind the shared ALB.
