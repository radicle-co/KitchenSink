# Correct a recipe's confirmed source answer

Use this runbook when a cook asks staff to change the source answer of a recipe. A cook cannot change a confirmed answer
(ADR-0100). Staff change it through one route, after the owner proves the request.

A correction makes the recipe private. It never makes a recipe public. Some corrections also hold the recipe off Public
for good. The owner's own clones of the recipe become private and held on every correction.

## Before you start

You need three things.

1. The grant `recipes:source:correct`. The admin and superuser roles hold it. See "Who holds the grant".
2. A session token of your own staff account in the variable `RECIPE_STAFF_TOKEN`.
3. The owner's account id and the id of every recipe the owner named.

## Step 1. Prove the request with a mailbox challenge

The request alone is not proof. Do not trust the sender of the request.

1. Find the owner's account in identity. Read the primary email address that Clerk marks as verified.
2. Send the challenge to that address only. Name each recipe by title and say what the new answer will be.
3. Act only on a reply in that same email thread.
4. If the email bounces, or no reply comes, do not correct anything. Never fall back to the address the request came from.

The support sending domain is registered as an Apple Email Source with SPF and DKIM. A Sign in with Apple relay address
therefore receives the challenge. If a relay address does not receive it, treat that as no reply.

The mailbox step cannot be checked by code. The field `ground` on the correction records that you did it.

## Step 2. Preview, confirm, apply

Run the command from the repository root. Give it every recipe id the owner named.

```
RECIPE_STAFF_TOKEN=... npm run correct-source --workspace=@kitchensink/recipe-service -- \
  --base-url https://recipe.commise.app \
  --owner <ownerAccountId> \
  --answer book --citation "Joy of Cooking, p. 12" \
  --reason "Owner asked by email thread <id>" \
  <recipeId> <recipeId>
```

The `--answer` values are `authored`, `fromPerson`, `public_web`, `book` and `paid_site`. A web link goes in `--citation`.
The reason is stored for audit. The command never prints it.

The command works in this order.

1. It reads every id and prints one line each: id, title, owner, current answer and visibility.
2. Check each line against the recipes in the owner's reply. A wrong recipe cannot be undone except by a migration.
3. It asks for the word `yes`. Any other answer sends nothing.
4. It sends one request per id and prints one result line per id.

The result lines are these.

| Line                                | Meaning                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `<id>: applied`                     | The answer changed. The recipe is private.                 |
| `<id>: already so`                  | The recipe already held that answer. Nothing was written.  |
| `<id>: failed (<status> <code>)`    | That id failed. The other ids still ran.                   |
| `<id>: preview failed ..., skipped` | The id was not found for that owner. It was not corrected. |

The exit code is 1 when any id failed or was skipped.

## What a correction does

| New answer                                      | Public hold                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "I wrote this" or "From another person"         | Held                                                                                       |
| Any answer, when the old answer was a paid site | Held                                                                                       |
| Any other change                                | Not held. The recipe meets the same rules as a recipe whose cook stated that answer first. |

A held recipe refuses Public with the reason `SOURCE_CORRECTED`. A hold lifts in two ways, both recorded and both described in ADR-0106. A staff member can clear it (see "Clear a hold"). The cook can also earn it back by rewriting the recipe, when every answer in its correction chain came from a third party.

## Clear a hold

Use this section when a correction was a mistake and the recipe should be readable again. For example, staff corrected a recipe
to "I wrote this" by mistake. A clear never makes a recipe public. It only removes the hold.

1. Run the preview from Step 2 for the recipe. The preview returns `latestCorrectionId`, the id of the newest correction in the
   recipe's chain. A clone with no correction of its own returns the id of its nearest ancestor.
2. Send `POST /api/v1/recipes/<id>/source-correction/hold-clear` with your staff token. The grant is `recipes:source:correct`.
   The body is `{ "ownerAccountId": "<owner>", "correctionId": "<latestCorrectionId>", "reason": "<why>" }`. Send `null` as
   `correctionId` only when the preview returned `null`.
3. A clear answers `{ "result": "cleared", "released": <n> }`. The number counts the recipe and every clone of the owner that
   the clear released.

A clear writes one append-only record per recipe released. Your account id and the reason stay on the record. Neither appears in
a log line or in any response a cook or a reader sees.

If the route answers `409 HOLD_CLEAR_CONFLICT`, read `details.reason`.

| `details.reason`        | Meaning and next step                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `HOLD_NOT_SET`          | The recipe has no hold now. Nothing to clear. Check that you used the right recipe id.                          |
| `CORRECTION_NOT_LATEST` | Someone corrected the recipe after your preview. Run the preview again and read the new chain before you clear. |
| `LOCK_CONFLICT`         | Another clear or correction was running on the same recipes. Wait a moment and send the request again.          |

An alarm fires when the metric `source.holdCleared` sums to more than 10 in one day. The metric counts holds released, so one
clear of a recipe with two clones counts three. Clears are rare and manual. More than 10 means a leaked grant or a runaway
script. Revoke the grant first, then investigate.

## Who holds the grant, and how to revoke it

The grant is a scope in the signed claim of the staff account. The roles admin and superuser carry it through
`ROLE_SCOPES`. To remove a person, change their role or their `public_metadata` in Clerk. Session tokens are short lived,
so the grant ends when the current token expires.

## Watch the volume

An alarm fires when more than 10 corrections happen in one day. Staff corrections are rare and manual. More than 10 means a
leaked grant or a runaway script. Revoke the grant first, then investigate.

To count corrections yourself, run this query in CloudWatch Logs Insights on the recipe API log group of the stage.

```
fields @timestamp, ground, oldKind, newKind
| filter event = "source.corrected"
| stats count() by bin(1d)
```

Refusals use the event `source.correctionRefused`. It names the refusal and the account id of the caller. No log line holds
an answer, a link, a citation or a reason.
