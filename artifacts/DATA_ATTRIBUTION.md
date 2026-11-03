# Data attribution and changes

Condliffe, Simon; Isgin, Ebru; Saboe, Matt (2026). **Gym Use Behavioral Economics Experiment**, version 1. Zenodo. https://doi.org/10.5281/zenodo.18866086

Copyright (C) 2026 Ebru Isgin, Simon Condliffe, and Matt Saboe.
Publisher metadata: https://zenodo.org/api/records/18866086 — metadata.license.id = cc-by-4.0.
Source file: fitness_clean_deid.csv, 70,678 bytes.
SHA256: 50d92eff3943937ff841a76c6609768263e545b38198be62ead47e6fa20d6bbb.

License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/); [legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en).
The source is provided without warranty. The authors and university do not endorse Gymmi.

## Gymmi modifications
Only prewk1, prewk2, prewk3 and week1 visit counts are retained as inputs. week2 is converted to attended_next_week = int(week2 > 0). A generated record_id identifies a file row, not a person. All other raw columns are excluded from clean_data.csv. features.csv contains train-fitted scaled inputs with ID, target and split metadata. Reports and fitted models are derived educational work; retain this attribution when distributing them. The raw file is downloaded locally and ignored by Git.

The file contains 389 records; the source description states 245 participants. The discrepancy is unresolved. No unique-person count, causal effect, person-independent evaluation or fitness-club deployment performance is claimed. Relative ordering of weeks is an explicit assumption from the field names.

This attribution applies to the Zenodo source and its derivatives. It does not grant rights to the old DataCamp/Fitness Class CSV. The old source and its artifacts remain private and are not submission data. CC BY does not itself resolve every privacy or other third-party right; no re-identification is attempted.
