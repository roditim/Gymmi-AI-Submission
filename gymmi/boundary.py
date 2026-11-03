"""Shared contract boundary. This module knows no raw data path or analyst internals."""
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from .contracts import DatasetContract

class ContractError(ValueError):
    pass

def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def read_contract(path):
    try:
        return DatasetContract.model_validate_json(Path(path).read_text(encoding='utf-8'))
    except Exception as exc:
        raise ContractError(f'Invalid dataset_contract.json: {exc}') from exc

def validate_boundary(clean_path, contract_path, approved_contract_sha=None):
    if approved_contract_sha and sha256(contract_path)!=approved_contract_sha:
        raise ContractError('Dataset contract changed after Analyst approval. Training blocked.')
    contract=read_contract(contract_path)
    raw=pd.read_csv(clean_path,dtype=str,keep_default_na=False)
    names=[c.name for c in contract.columns]
    if list(raw.columns)!=names:
        raise ContractError(f'Column schema mismatch. Expected {names}; received {list(raw.columns)}. Training blocked.')
    if len(raw)!=contract.rows:
        raise ContractError(f'Row count mismatch: expected {contract.rows}, got {len(raw)}. Training blocked.')
    df=raw.copy()
    for spec in contract.columns:
        s=raw[spec.name]
        missing=s.eq('')
        if missing.any() and not spec.nullable:
            raise ContractError(f'{spec.name}: null value is forbidden. Training blocked.')
        if spec.dtype in ['integer','number']:
            try:
                values=pd.to_numeric(s.mask(missing),errors='raise')
            except (ValueError,TypeError) as exc:
                raise ContractError(f'{spec.name}: expected {spec.dtype}. Training blocked.') from exc
            valid=values.dropna()
            if not np.isfinite(valid).all():
                raise ContractError(f'{spec.name}: non-finite value. Training blocked.')
            if spec.dtype=='integer' and ((valid%1)!=0).any():
                raise ContractError(f'{spec.name}: integer required. Training blocked.')
            if spec.minimum is not None and (valid<spec.minimum).any():
                raise ContractError(f'{spec.name}: below minimum {spec.minimum} {spec.unit}. Training blocked.')
            if spec.maximum is not None and (valid>spec.maximum).any():
                raise ContractError(f'{spec.name}: above maximum {spec.maximum} {spec.unit}. Possible unit change. Training blocked.')
            if spec.allowed_values is not None and not valid.isin(spec.allowed_values).all():
                raise ContractError(f'{spec.name}: forbidden value. Training blocked.')
            df[spec.name]=values.astype(int) if spec.dtype=='integer' and not missing.any() else values
        elif spec.allowed_values is not None and not s[~missing].isin(spec.allowed_values).all():
            raise ContractError(f'{spec.name}: unknown category. Training blocked.')
        if spec.unique and s.duplicated().any():
            raise ContractError(f'{spec.name}: duplicate identifier. Training blocked.')
    if sha256(clean_path)!=contract.dataset_sha256:
        raise ContractError('Clean data checksum differs from the published contract. Training blocked.')
    return df,contract
