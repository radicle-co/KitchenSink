# Quickstart: try public versions locally (once built)

Nothing here runs today. The feature is planned, not built.

1. Bring up the local stack: `npm run local:up` (LocalStack and Postgres). Run the recipe migrations.
2. Turn the feature switch on for the local stage only. Every market is on at launch (ADR-0093 §6a).
3. Point the worker at a stub writer, or at Bedrock with a scoped, non-root profile (the default profile is root).
4. Paste a blog page with JSON-LD into Add a recipe on web. Finish the match review.
5. Choose "For everyone". Wait for the review. Check:
    - the steps are new, and every amount, time and temperature matches the paste.
    - "Show my copy" shows the pasted steps.
    - the credit and licence lines show, and no page photo.
6. Publish with a test cook that has no age claim. The age question shows. Choose "Not now": nothing publishes and the
   review screen returns. Publish again and choose "I'm 16 or over". The recipe publishes after one retry and reads
   "Checking".
7. Edit its steps back to the pasted wording. The save is refused.
8. Repeat with a paid-site page, which is clearly paid. Once the page evidence carries the paid facts, a page newer than
   6 months reads Private only: one line and "Save my copy", and an older one shows the choice with a credit that names
   no site. A page whose paywall cannot be read shows the choice with `credit.written` only and no hold.
9. Fill 50 private slots on a Free test cook. Paste a paid-site page. The dead end shows. Try "Not now".
10. Repeat 4 to 9 on Android and iOS through the mobile app.

Clean up: stop the local stack, delete the test cook's recipes, and remove any stub writer files.
