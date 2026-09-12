# 2026-09-22 measurements: inputs

Every script in `docs/reports/2026-09-21/` and `docs/reports/2026-09-22/` reads its input from `.local-sandbox/`,
which git ignores. A session scratch directory under `/tmp` held these inputs at first, and a machine restart deleted
them. The paths below replace it.

Download the inputs before you run a script. If a checksum does not match, the input is a different release, and a
figure computed from it is a different measurement.

| Path under `.local-sandbox/`                             | Source                                                                                                                                          | sha256                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `foodon/foodon.owl`                                      | `http://purl.obolibrary.org/obo/foodon.owl` (CC BY 4.0)                                                                                         | `b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf` |
| `foodon/foodonSynonyms.tsv`                              | `https://raw.githubusercontent.com/FoodOntology/foodon/master/foodon-synonyms.tsv`                                                              | `1900fb2c80d834287cfdd0b52a98957b18269e86c197617711bc3a5d8541deb2` |
| `fdc/FoodData_Central_csv_2026-04-30/food_attribute.csv` | USDA FoodData Central full CSV bundle, 2026-04-30                                                                                               | `c25e8f1ce2c32eb57dc6e8d49bfbbcfb71debf379cf9c418ce907983512cd70c` |
| `nltk_data/corpora/wordnet.zip`                          | `python3 -m nltk.downloader -d .local-sandbox/nltk_data wordnet` (plurals in `labelCleanup.py`, `foodOnMappingPatch.py`, `emptyStripGroups.py`) | `cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59` |
| `fdc/FoodData_Central_sr_legacy_food_csv_2018-04/`       | USDA SR Legacy CSV, 2018-04                                                                                                                     | not recorded                                                       |

The FoodOn PURL serves the repository's `master` branch, not a tagged release. Record the sha256 when you download.
