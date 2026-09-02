---
title: Commise engineering documentation
description: Architecture, standards and generated references for the Commise platform
hide_table_of_contents: false
---

# Commise engineering documentation

This site is assembled from the repository at build time. It **references** documents where they
live and never copies them, so nothing here can drift away from the source it describes.

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

The site is **not deployed anywhere**. CI proves it builds; where it should be hosted is an open
decision with cost implications.
