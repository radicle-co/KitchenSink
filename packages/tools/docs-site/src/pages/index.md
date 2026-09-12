---
title: Commise engineering documentation
description: Architecture, standards and generated references for the Commise platform
hide_table_of_contents: false
---

# Commise engineering documentation

This site is assembled from the repository at build time. It **references** documents where they
live and never copies them, so nothing here can drift away from the source it describes.

## ⛔ This site is PUBLIC

**There is no login in front of this page.** Anyone with the URL can read every word of every section,
and search engines can index it. That is a deliberate decision, not an oversight — publishing it behind
Vercel Authentication turned out not to be possible on this team's plan, and, worse, to fail _open_ while
reporting success. So the protection was dropped and replaced by a rule about the contents.

Two consequences, for anyone adding to it:

- **What ships is decided by one allowlist**, `CONTENT_SOURCES` in
  `packages/tools/docs-site/src/content/contentRegistry.ts`. Widening it publishes whatever the new glob
  reaches. Read what you are admitting before you admit it.
- **The AWS account id is deliberately absent**, and stays absent because it is checked. Where a document
  needs to say _which_ account something was measured against, it writes the placeholder
  `<aws-account-id>` instead of the digits. `.github/workflows/docs.yml` scans the built site for a real
  one before the artifact is even uploaded, and the repository's test tier scans the sources — both by
  running `scripts/assertNoAwsAccountIds.mjs`, which _derives_ the ids from the repository's own ARNs so
  that the guard never has to restate the value it keeps out of print. If either goes red, scrub the
  document; do not weaken the guard.

Nothing here is a credential. If you ever find something that is, it needs **rotating**, not editing.

## ⚠️ Read this before you trust a page

**Every page on this site describes what a commit DECLARES. No page describes what is deployed.**

The two are routinely different, sometimes by weeks. A hand-written table in this repository once
listed Lambda handlers as though they were running while production sat a month behind the commit
that declared them; the table was an accurate description of the source and a false description of
the world, and nothing in its wording admitted the gap. Generated documentation has exactly the same
failure mode — generating a claim does not make it true of production, it only makes it true of the
source.

So read the Infrastructure section as _"as of this commit, the CDK declares …"_. To learn what is
running, query AWS.

## What is here

| Section            | Origin                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Handbook**       | Hand-written and committed: the ADRs, the coding standards, the engineering quality bar, the CI architecture, the runbooks. Mounted from `docs/` in place. |
| **Infrastructure** | Generated from the CDK source into `docs/generated/infrastructure/`.                                                                                       |
| **Components**     | Generated from the shared React component library into `docs/generated/components/`.                                                                       |
| **Design system**  | Generated from the design tokens into `docs/generated/design/`.                                                                                            |

A generated section that has not been generated in your checkout says so on its own page. It does
not show stale content, sample content, or an empty page — and its navbar link still works, so you
find out the section exists rather than never learning of it.

## What is deliberately absent

`docs/` also holds working material — review notes, plans, brainstorms, reports, competitive
analyses. That is correspondence, not documentation, and it is not published here. The published set
is an **allowlist** in `packages/tools/docs-site/src/content/contentRegistry.ts`; a build fails if any
entry in it stops reaching files, so a section cannot quietly vanish.

## Running it

```bash
npm run docs:dev   --workspace=@kitchensink/docs-site   # local dev server with hot reload
npm run docs:build --workspace=@kitchensink/docs-site   # production build, into build/
npm run docs:serve --workspace=@kitchensink/docs-site   # serve the production build
```

The site is published to Vercel by `.github/workflows/docs.yml` on every push to `main`, and on demand.
Pull requests build it but never deploy it — and the build is where both content gates run, so a change
that would publish a broken link or an AWS account id is red before it can merge.
