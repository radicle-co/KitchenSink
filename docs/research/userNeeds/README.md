# User needs database: cooking, finding recipes, grocery lists, meal planning

A long-term record of the real problems people have around home cooking. It is for every designer, product owner and
engineer who works on Commise. It describes the problem space, not Commise. Record the truth even
if it is inconvenient for the app.

## What kind of evidence this is

This is desk research. Nobody here interviewed or watched a user. The evidence is what people wrote themselves (forum
posts, app-store reviews, comments) plus published studies and surveys. Every record says which kind it is, so a
reader can weigh it.

| Code | Evidence type                                                           | Weight                         |
| ---- | ----------------------------------------------------------------------- | ------------------------------ |
| `S`  | Peer-reviewed study, or a survey with a stated method and sample        | Highest                        |
| `M`  | Industry or market survey with a stated sample but a commercial owner   | Medium                         |
| `V`  | People's own words: forum posts, reviews, comments, quoted with a link  | Real voices, but self-selected |
| `X`  | Expert or practitioner writing (designers, food writers, product teams) | Context, not user evidence     |

If a problem has `S` or `M` evidence, or `V` evidence from at least three independent places, it counts as
**validated**. Otherwise it is **reported**, and the record says so.

## Files

- `cooking.md`: problems while cooking a recipe.
- `findingRecipes.md`: problems finding, choosing, saving and trusting recipes.
- `groceryLists.md`: problems making and using a grocery list, and shopping.
- `mealPlanning.md`: problems planning meals for a day or a week.
- `synthesis.md`: the cross-topic summary, the ranked needs and the open questions.

## Record format

Each problem is one record, in this exact shape. IDs are stable. Never renumber. Add new records at the end.

```markdown
### CK-001: <the problem, in the user's terms, one line>

- **Status:** validated | reported
- **Who:** <the people it affects, for example new cooks, parents, people on a budget>
- **When:** <the moment it happens, for example mid-recipe with wet hands>
- **Need:** <what the person is trying to get done, in one sentence, with no solution in it>
- **Evidence:**
    - `V` "<quote>" (<source name, date>, <URL>)
    - `S` <finding, with the number> (<study, year, sample>, <URL>)
- **How often / how bad:** <what the evidence says about frequency and severity, or "unknown">
- **Workarounds people use:** <what they do today>
- **Where current products fail:** <named apps or sites, with evidence>
- **Open questions:** <what the evidence does not answer>
```

ID prefixes: `CK` cooking, `FR` finding recipes, `GL` grocery lists, `MP` meal planning.

## Rules for adding to it

1. Quote people word for word, with a link. Never invent or merge quotes.
2. State a need without a solution in it. "Know the next step without touching the phone" is a need. "Voice control"
   is a solution.
3. Record evidence against a problem as well as for it.
4. Date every source. Needs change, and an old complaint can be solved by now.
