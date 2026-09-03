---
title: Infrastructure — not generated yet
sidebar_label: Not generated yet
---

# Infrastructure documentation has not been generated in this checkout

This section is **generated**, not written. Nothing has been written to
`docs/generated/infrastructure/` in the commit you are looking at, so the site is showing you this
page instead of pretending the section is empty by design.

Nothing here is a placeholder for content that "should" exist somewhere — there is no stale copy, no
cached rendering, and no example output. The section is genuinely absent.

## What belongs here

A rendering of what the CDK application **declares**: per-stage stacks, Lambda handlers, queues and
their dead-letter queues, alarms, ECS services and SSM parameters — derived from the CDK source in
this repository, together with a `manifest.json` holding the same facts in machine-readable form.

## ⚠️ What this section will never tell you

**It describes what a commit DECLARES. It does not describe what is deployed.**

That distinction is the reason this section exists at all. A hand-written table in this repository
once listed Lambda handlers as though they were running while production sat a month behind the
commit that declared them — the document was accurate about the source and wrong about the world, and
nothing in its wording admitted the difference. A generated document has exactly the same failure
mode unless the difference is stated on its face.

So: read every page in this section as _"as of this commit, the CDK declares …"_. To learn what is
actually running, query AWS.

## How to fill it in

Run the infrastructure documentation generator, which writes into `docs/generated/infrastructure/`
and commits its output the way this repository commits every other generated artefact. The moment
that directory contains Markdown, this page disappears and the real content is mounted at the same
route — the site needs no configuration change.
