# Gymmi weekly-visit insights

The licensed study file has 389 records. The outcome is whether week2 has any visits: 182 positive records (46.79%). Records are not a verified count of unique people.

Only prewk1, prewk2, prewk3 and week1 become model inputs. week2 defines the target. Later weeks, totals, rewards, demographics and academic data are excluded.

The selected columns have no missing values. Repeated input histories can have different outcomes. Equal histories are grouped during splitting; this conservative stress test can create unequal split sizes and prevalence.

The source description refers to 245 participants, while the file has 389 rows. Without person identifiers we cannot resolve the discrepancy or prove person-independent evaluation. Relative week ordering is assumed from column names; exact dates are absent.

These are descriptive associations from an experiment, not evidence of causal incentives, calibrated probabilities or reliable deployment in a new gym. CC BY 4.0 attribution and changes are in DATA_ATTRIBUTION.md.


## Structured agent review (live_llm)
Qualitative statements still require human review. Numeric claims are checked against scoped evidence.

### ingest
The ingest completed and produced a cleaned dataset artifact. The evidence indicates a binary target with a near-balanced split, no missingness in the listed cleaned fields, and no duplicate identifiers. There is also substantial duplication across non-identifier, non-target features, so downstream handling should account for repeated feature patterns rather than assuming fully unique rows.
- The cleaned fields listed in evidence show no missingness.
- The identifier field shows no duplicates.
- The binary target is close to balanced.
- Repeated feature patterns remain after excluding identifier and target fields.
- Do not assume the repeated feature patterns are harmless; they may affect downstream modeling or grouping logic.
- Overfitting cannot be assessed from validation/test similarity alone.
- Evidence `rows`: `389`
- Evidence `attendance_rate`: `0.46786632390745503`
- Evidence `target_counts.0`: `207`
- Evidence `target_counts.1`: `182`
- Evidence `missing_clean.record_id`: `0`
- Evidence `missing_clean.prewk1`: `0`
- Evidence `record_id_duplicates`: `0`
- Evidence `feature_duplicates_excluding_id_and_target`: `241`

### explore
The explore stage completed and produced the expected report artifacts. The evidence points to a binary target with a near-balanced split, no missingness in the listed cleaned fields, and no duplicate identifiers. Repeated feature patterns remain after excluding identifier and target fields, so downstream handling should account for non-unique feature combinations rather than assuming fully distinct rows.
- The cleaned fields listed in evidence show no missingness.
- The identifier field shows no duplicates.
- The binary target is close to balanced.
- Repeated feature patterns remain after excluding identifier and target fields.
- Do not assume the repeated feature patterns are harmless; they may affect downstream modeling or grouping logic.
- Overfitting cannot be assessed from validation/test similarity alone.
- Evidence `rows`: `389`
- Evidence `attendance_rate`: `0.46786632390745503`
- Evidence `target_counts.0`: `207`
- Evidence `target_counts.1`: `182`
- Evidence `missing_clean.record_id`: `0`
- Evidence `missing_clean.prewk1`: `0`
- Evidence `missing_clean.prewk2`: `0`
- Evidence `missing_clean.prewk3`: `0`

### publish
The publish step completed and produced the contract artifact. The evidence indicates a binary target, a selected validation metric, and approval for public distribution. The dataset size is fixed, but the tool evidence is limited to a small set of publish-time fields, so deeper data quality or leakage assessment is not available from this step alone.
- The selected target is binary.
- The selected metric is validation-based.
- Public distribution is approved.
- The license status is permissive.
- This step does not expose row-level quality checks, so missingness, duplication, and leakage cannot be re-evaluated here.
- Overfitting cannot be assessed from validation/test similarity alone.
- Evidence `rows`: `389`
- Evidence `license_status`: `"CC-BY-4.0"`
- Evidence `public_distribution_approved`: `true`
- Evidence `target`: `"attended_next_week"`
- Evidence `selection_metric`: `"validation_average_precision"`
