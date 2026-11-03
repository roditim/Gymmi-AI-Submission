"Licensed weekly gym-visit study. Only prior visit counts become inputs."
import hashlib
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import pandas as pd

URL = 'https://zenodo.org/api/records/18866086/files/fitness_clean_deid.csv/content'
DOI = '10.5281/zenodo.18866086'
VERSION = '1'
SHA256 = '50d92eff3943937ff841a76c6609768263e545b38198be62ead47e6fa20d6bbb'
LICENSE = 'CC-BY-4.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
AUTHORS = 'Simon Condliffe; Ebru Isgin; Matt Saboe'
PRIMARY = ['prewk1', 'prewk2', 'prewk3', 'week1']
TARGET = 'attended_next_week'
COLUMNS = ['record_id', *PRIMARY, TARGET]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def download(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(Request(URL, headers={'User-Agent': 'Gymmi-Student-Project'}), timeout=30) as response:
        payload = response.read(1_000_000)
    if hashlib.sha256(payload).hexdigest() != SHA256:
        raise ValueError('Source checksum mismatch; stop and review dataset version.')
    path.write_bytes(payload)
    return path


def load_clean(path, verify=True):
    if verify and digest(path) != SHA256:
        raise ValueError('Dataset checksum mismatch')
    raw = pd.read_csv(path)
    required = PRIMARY + ['week2']
    if not set(required).issubset(raw.columns) or raw.empty:
        raise ValueError('Missing visit-history or outcome columns')
    counts = raw[required].apply(pd.to_numeric, errors='raise')
    if counts.isna().any().any() or not np.isfinite(counts.to_numpy()).all():
        raise ValueError('Missing/non-finite weekly counts; never impute the outcome')
    if ((counts < 0) | (counts > 100) | (counts % 1 != 0)).any().any():
        raise ValueError('Weekly visits must be integer counts between zero and one hundred')
    clean = counts[PRIMARY].astype(int).copy()
    # A row key is not an invented participant identifier.
    clean.insert(0, 'record_id', [f'row-{i+1:04d}' for i in range(len(raw))])
    clean[TARGET] = (counts['week2'] > 0).astype(int)
    return raw, clean


def profile(raw, clean):
    signature = pd.util.hash_pandas_object(clean[PRIMARY], index=False)
    return {'rows': len(clean), 'raw_columns': list(raw.columns), 'columns': COLUMNS,
        'raw_dtypes': {c: str(t) for c, t in raw.dtypes.items()},
        'clean_dtypes': {c: str(t) for c, t in clean.dtypes.items()},
        'missing_raw': raw.isna().sum().astype(int).to_dict(),
        'missing_clean': clean.isna().sum().astype(int).to_dict(),
        'target_counts': {str(k): int(v) for k, v in clean[TARGET].value_counts().items()},
        'attendance_rate': float(clean[TARGET].mean()),
        'full_row_duplicates': int(raw.duplicated().sum()),
        'record_id_duplicates': int(clean.record_id.duplicated().sum()),
        'feature_duplicates_excluding_id_and_target': int(signature.duplicated().sum()),
        'conflicting_feature_groups': int((clean.groupby(signature)[TARGET].nunique() > 1).sum()),
        'numeric_summary': clean[PRIMARY].describe().to_dict(), 'primary_features': PRIMARY,
        'source_description_participants': 245, 'file_records': len(raw),
        'participant_count_explanation': 'The record says 245 participants; the file has 389 rows. Row identity is not person identity.',
        'excluded_source_columns': [c for c in raw.columns if c not in PRIMARY],
        'leakage_review': ['week2 only defines the binary outcome.',
            'Later weeks, totals, change scores, rewards, demographics and academic data are excluded.',
            'Exact histories share a split; this does not prove person independence.',
            'Relative week ordering is assumed from column names; exact dates are absent.']}
