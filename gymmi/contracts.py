from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class VisitHistory(Strict):
    prewk1: int = Field(ge=0,le=100,strict=True)
    prewk2: int = Field(ge=0,le=100,strict=True)
    prewk3: int = Field(ge=0,le=100,strict=True)
    week1: int = Field(ge=0,le=100,strict=True)

class Column(Strict):
    name: str
    dtype: Literal['string','integer','number']
    unit: str
    nullable: bool = False
    minimum: float | None = None
    maximum: float | None = None
    allowed_values: list[str | int] | None = None
    unique: bool = False

class FeatureSpec(Strict):
    numeric: list[str] = Field(min_length=1)
    categorical: list[str] = Field(default_factory=list)
    excluded: dict[str,str]
    numeric_imputation: Literal['train_median'] = 'train_median'
    numeric_scaling: Literal['train_standard_scaler'] = 'train_standard_scaler'
    categorical_encoding: Literal['train_one_hot_error_on_unknown'] = 'train_one_hot_error_on_unknown'

class SplitSpec(Strict):
    method: Literal['stratified_group_5_outer_4_inner'] = 'stratified_group_5_outer_4_inner'
    seed: int = 42
    group_columns: list[str] = Field(min_length=1)
    target: str
    id_column: str
    positive_class: int = 1
    selection_metric: Literal['validation_average_precision'] = 'validation_average_precision'
    threshold_metric: Literal['validation_f1'] = 'validation_f1'

class DatasetContract(Strict):
    schema_version: Literal['3.0'] = '3.0'
    run_id: str
    producer: Literal['Data Analyst Crew'] = 'Data Analyst Crew'
    dataset_file: Literal['clean_data.csv'] = 'clean_data.csv'
    dataset_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    rows: int = Field(gt=0)
    columns: list[Column] = Field(min_length=2)
    features: FeatureSpec
    split: SplitSpec
    source: dict[str,str]
    assumptions: list[str] = Field(min_length=3)
    constraints: list[str] = Field(min_length=3)
    license_status: Literal['CC-BY-4.0'] = 'CC-BY-4.0'
    public_distribution_approved: Literal[True] = True

    @model_validator(mode='after')
    def no_leakage_or_undefined_columns(self):
        names=[c.name for c in self.columns]
        if len(names)!=len(set(names)):
            raise ValueError('Contract has duplicate column declarations')
        inputs=self.features.numeric+self.features.categorical
        if len(inputs)!=len(set(inputs)):
            raise ValueError('Feature listed more than once')
        if not set(inputs+self.split.group_columns+[self.split.target,self.split.id_column]).issubset(names):
            raise ValueError('Contract refers to an undeclared column')
        if self.split.target in inputs or self.split.id_column in inputs:
            raise ValueError('Target or identifier leakage in contract features')
        if set(inputs)&set(self.features.excluded):
            raise ValueError('Excluded column also selected as a feature')
        target=next(c for c in self.columns if c.name==self.split.target)
        if target.nullable or set(target.allowed_values or [])!={0,1}:
            raise ValueError('Binary non-null target declaration is required')
        return self

class StageReceipt(Strict):
    run_id: str
    crew: Literal['analyst','scientist']
    stage: str
    status: Literal['done'] = 'done'
    artifacts: list[str]

LIMITATIONS=[
 'CC BY 4.0 requires attribution and identification of changes; see DATA_ATTRIBUTION.md.',
 'The source description says 245 participants but the file has 389 rows; no unique-person count is claimed.',
 'No participant identifiers or exact dates are available; equal-history groups do not prove person independence.',
 'Relative week ordering and availability of prewk1-prewk3 before week1/week2 are assumptions based on source names.',
 'The target is any week2 visit, not a booked-class no-show or a causal incentive effect.',
 'The grouped split is a conservative history-pattern stress test, not a temporal or participant-held-out evaluation.',
 'This small university experiment does not establish performance in a new gym.',
 'The test is descriptive after validation selection, not an independent external evaluation.',
]
