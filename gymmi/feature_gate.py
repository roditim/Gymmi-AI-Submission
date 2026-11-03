"""Reconstruct the approved design from the handoff before any estimator fit."""
import csv
import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .boundary import ContractError, sha256, validate_boundary


@dataclass
class Design:
    data: pd.DataFrame
    contract: object
    splits: dict
    preprocessor: ColumnTransformer
    values: np.ndarray
    names: list[str]


def build_design(data, contract) -> Design:
    """The declared feature recipe; no estimator is constructed or fitted here."""
    c = contract
    groups = pd.util.hash_pandas_object(data[c.split.group_columns], index=False).to_numpy()
    target = data[c.split.target]
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=c.split.seed)
    development, test = next(outer.split(data, target, groups))
    inner = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=c.split.seed + 1)
    train, validation = next(inner.split(data.iloc[development], target.iloc[development], groups[development]))
    splits = {'train': development[train], 'validation': development[validation], 'test': test}
    for left, right in [('train', 'validation'), ('train', 'test'), ('validation', 'test')]:
        if set(groups[splits[left]]) & set(groups[splits[right]]):
            raise ContractError('Exact input group crosses split boundaries. Training blocked.')
    transformers = [('num', Pipeline([('impute', SimpleImputer(strategy='median')),
        ('scale', StandardScaler())]), c.features.numeric)]
    if c.features.categorical:
        transformers.append(('cat', OneHotEncoder(handle_unknown='error', sparse_output=False), c.features.categorical))
    pre = ColumnTransformer(transformers, remainder='drop')
    pre.fit(data.iloc[splits['train']])
    return Design(data, c, splits, pre, pre.transform(data), pre.get_feature_names_out().tolist())


def feature_metadata(design: Design, contract_path: Path) -> dict:
    c, data = design.contract, design.data
    return {'contract_sha256': sha256(contract_path), 'model_features': design.names,
        'metadata_only_columns': [c.split.id_column, c.split.target, 'split'],
        'preprocessing_fit_record_ids': data.iloc[design.splits['train']][c.split.id_column].tolist(),
        'fit_rows': len(design.splits['train']), 'target': c.split.target,
        'input_numeric': c.features.numeric, 'input_categorical': c.features.categorical}


def validate_features(clean_path, contract_path, feature_path, metadata_path, approved_contract_sha):
    """Trust neither cached arrays nor producer-supplied feature names/checksums."""
    try:
        data, contract = validate_boundary(clean_path, contract_path, approved_contract_sha)
        design = build_design(data, contract)
        expected_columns = [contract.split.id_column, *design.names, contract.split.target, 'split']
        feature_bytes = Path(feature_path).read_bytes()
        metadata_bytes = Path(metadata_path).read_bytes()
        feature_hash = hashlib.sha256(feature_bytes).hexdigest()
        metadata_hash = hashlib.sha256(metadata_bytes).hexdigest()
        columns = next(csv.reader(io.StringIO(feature_bytes.decode('utf-8'))))
        if columns != expected_columns:
            raise ContractError('Feature schema mismatch or forbidden input column. Training blocked.')
        saved = pd.read_csv(io.BytesIO(feature_bytes), dtype={contract.split.id_column: str}, float_precision='round_trip')
        if len(saved) != len(data):
            raise ContractError('Feature row count mismatch. Training blocked.')
        if saved[contract.split.id_column].tolist() != data[contract.split.id_column].tolist():
            raise ContractError('Feature row identity/alignment mismatch. Training blocked.')
        if not np.array_equal(saved[contract.split.target].to_numpy(), data[contract.split.target].to_numpy()):
            raise ContractError('Feature target differs from the handoff. Training blocked.')
        expected_split = np.empty(len(data), dtype=object)
        for name, indexes in design.splits.items():
            expected_split[indexes] = name
        if not np.array_equal(saved['split'].to_numpy(), expected_split):
            raise ContractError('Feature split assignments differ from the contract recipe. Training blocked.')
        actual = saved[design.names].to_numpy(dtype=float)
        if not np.isfinite(actual).all() or not np.allclose(actual, design.values, rtol=0, atol=1e-12):
            raise ContractError('Feature values differ from training-only preprocessing. Training blocked.')
        metadata = json.loads(metadata_bytes)
        if metadata != feature_metadata(design, Path(contract_path)):
            raise ContractError('Feature metadata or preprocessing fit rows mismatch. Training blocked.')
        if sha256(feature_path) != feature_hash or sha256(metadata_path) != metadata_hash:
            raise ContractError('Feature artifacts changed during validation. Training blocked.')
        # Train from the validated saved matrix, not the recomputed reference matrix.
        design.values = actual
        report = {'passed': True, 'rows': len(data), 'model_feature_count': len(design.names),
            'contract_sha256': sha256(contract_path), 'clean_sha256': sha256(clean_path),
            'features_sha256': feature_hash, 'metadata_sha256': metadata_hash,
            'numeric_absolute_tolerance': 1e-12, 'preprocessing_fit': 'train_only',
            'checks': ['schema', 'row_identity', 'target', 'split', 'finite_values', 'derived_values', 'metadata']}
        return design, report
    except ContractError:
        raise
    except (OSError, ValueError, KeyError, StopIteration, TypeError) as exc:
        raise ContractError(f'Cannot validate feature artifacts: {exc}. Training blocked.') from exc
