# Dataset decision — 2026-11-03

The active task changes explicitly from booked-class no-show prediction to **any recorded gym visit in week2 from prior visit counts**. The course allows choosing a dataset; changing the business question is preferable to asserting unverified redistribution rights.

| Source | Licensing evidence | Decision |
|---|---|---|
| Fitness Class Prediction / DataCamp mirror | No explicit grant established for the CSV | Keep old runs private; never relabel with a mirror repository license |
| Sport Services Dataset, DOI 10.17632/yprk4jdgnv.1 | Publisher CC BY 4.0 | Not selected: end-of-enrollment and lifetime aggregates can leak the outcome |
| Gym occupancy, DOI 10.17632/kjgrct2yn3.3 | Publisher CC BY 4.0 | Not selected: class/day confounding across very few sessions makes a credible day-held-out evaluation difficult |
| Gym Use Behavioral Economics Experiment, DOI 10.5281/zenodo.18866086 | Official API metadata cc-by-4.0; pinned source checksum | Selected with attribution and declared transformations |

See DATA_ATTRIBUTION.md for full source credit. Review used publisher records and actual downloaded files; no author was contacted and no special permission was obtained.

## Data and evaluation limits
389 rows, 71 raw columns, no full-row duplicates. The selected four inputs and derived target have no missing values. Target counts: no visit 207, any visit 182. Repeated input histories: 241 rows beyond the first occurrence, leaving 148 distinct histories. Raw demographics, GPA, treatments, rewards, totals and later weeks never become inputs.

The publisher says 245 participants; row-to-person mapping is absent. Grouping identical histories prevents those histories from crossing partitions but does not identify people. With the predeclared seed, partitions are unequal (182/64/143) and have differing prevalence. This is a history-pattern stress test, not a temporal/person-held-out deployment estimate. No seed search is performed to improve the test result.

## Publication boundary
This public export includes only the selected licensed visit counts and derived artifacts, with attribution. It excludes the private course inventories, links and Git history, credentials, raw CSV and legacy data/runs. The public history begins at export; earlier work is disclosed in EXPORT_PROVENANCE.json rather than recreated as fabricated commits.
