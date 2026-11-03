"""Publish complete runs atomically; old success flags alone never authorize scoring."""
import hashlib
import json
import os
import uuid
from pathlib import Path

from .boundary import ContractError, sha256

REQUIRED_OUTPUTS = ['clean_data.csv', 'eda_report.html', 'insights.md', 'dataset_contract.json',
    'features.csv', 'model.joblib', 'evaluation_report.md', 'model_card.md']
EVIDENCE_FILES = ['feature_metadata.json', 'feature_validation.json', 'metrics.json',
    'scientist_review.json', 'execution_log.jsonl', 'run_manifest.json']
MARKERS = {'INCOMPLETE.json', 'FAILED.json', 'SUCCESS.json'}


class ArtifactError(ValueError):
    pass


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + '.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def begin(folder: Path, run_id: str) -> None:
    (folder / 'SUCCESS.json').unlink(missing_ok=True)
    atomic_json(folder / 'INCOMPLETE.json', {'run_id': run_id})


def fail(folder: Path, run_id: str, error: str) -> None:
    (folder / 'SUCCESS.json').unlink(missing_ok=True)
    atomic_json(folder / 'FAILED.json', {'run_id': run_id, 'error': error})


def ensure_incomplete(folder: Path) -> str:
    """Direct Scientist calls invalidate scoring too, without inventing completion."""
    marker = folder / 'INCOMPLETE.json'
    (folder / 'SUCCESS.json').unlink(missing_ok=True)
    if marker.is_file():
        try:
            run_id = json.loads(marker.read_text(encoding='utf-8')).get('run_id')
            if isinstance(run_id, str) and run_id:
                return run_id
        except (OSError, ValueError, AttributeError):
            pass
    run_id = str(uuid.uuid4())
    begin(folder, run_id)
    return run_id


def _file(folder: Path, name: str) -> Path:
    if Path(name).name != name or '/' in name or '\\' in name:
        raise ArtifactError('Invalid artifact filename. Prediction blocked.')
    path = folder / name
    if path.is_symlink() or not path.is_file():
        raise ArtifactError(f'Missing or unsafe artifact: {name}. Prediction blocked.')
    return path


def _bindings(folder: Path) -> dict:
    manifest = json.loads(_file(folder, 'run_manifest.json').read_text(encoding='utf-8'))
    contract = json.loads(_file(folder, 'dataset_contract.json').read_text(encoding='utf-8'))
    metrics = json.loads(_file(folder, 'metrics.json').read_text(encoding='utf-8'))
    gate = json.loads(_file(folder, 'feature_validation.json').read_text(encoding='utf-8'))
    if not all(isinstance(value, dict) for value in [manifest, contract, metrics, gate]):
        raise ArtifactError('Invalid evidence document type. Prediction blocked.')
    if contract.get('schema_version') != '3.0':
        raise ArtifactError('Legacy dataset contract; use a weekly-study run. Prediction blocked.')
    if manifest.get('success') is not True or manifest.get('validation_passed') is not True or manifest.get('stage') != 'completed':
        raise ArtifactError('The run did not complete both validation gates. Prediction blocked.')
    if manifest.get('required_outputs') != REQUIRED_OUTPUTS:
        raise ArtifactError('Unexpected required artifact set. Prediction blocked.')
    contract_hash = sha256(folder / 'dataset_contract.json')
    if contract.get('dataset_sha256') != sha256(folder / 'clean_data.csv'):
        raise ArtifactError('Clean data no longer matches its contract. Prediction blocked.')
    if metrics.get('run_id') != contract.get('run_id') or metrics.get('input_contract_sha256') != contract_hash:
        raise ArtifactError('Model evaluation belongs to another handoff. Prediction blocked.')
    if manifest.get('contract_sha256') != contract_hash or gate.get('passed') is not True:
        raise ArtifactError('Missing approved contract or feature gate. Prediction blocked.')
    for name, key in [('clean_data.csv', 'clean_sha256'), ('features.csv', 'features_sha256'),
                      ('feature_metadata.json', 'metadata_sha256'), ('dataset_contract.json', 'contract_sha256')]:
        if gate.get(key) != sha256(folder / name):
            raise ArtifactError('Feature validation evidence is stale. Prediction blocked.')
    expected_hashes = manifest.get('artifacts_sha256', {})
    if not isinstance(expected_hashes, dict):
        raise ArtifactError('Invalid run manifest hashes. Prediction blocked.')
    for name in REQUIRED_OUTPUTS + EVIDENCE_FILES[:-1]:
        if expected_hashes.get(name) != sha256(_file(folder, name)):
            raise ArtifactError(f'Manifest mismatch: {name}. Prediction blocked.')
    return manifest


def publish(folder: Path, run_id: str) -> None:
    manifest = _bindings(folder)
    if manifest.get('run_id') != run_id:
        raise ArtifactError('Completion identity differs from the current run.')
    hashes = {p.name: sha256(_file(folder, p.name)) for p in folder.iterdir()
        if p.is_file() and p.name not in MARKERS and not p.name.endswith('.tmp')}
    if not set(REQUIRED_OUTPUTS + EVIDENCE_FILES).issubset(hashes):
        raise ArtifactError('Required artifacts or evidence are incomplete.')
    # Keep INCOMPLETE/FAILED blocking readers until the approval is fully replaced.
    atomic_json(folder / 'SUCCESS.json', {'version': 2, 'run_id': run_id,
        'dataset_run_id': json.loads((folder / 'dataset_contract.json').read_text(encoding='utf-8'))['run_id'],
        'artifacts_sha256': hashes})
    (folder / 'FAILED.json').unlink(missing_ok=True)
    (folder / 'INCOMPLETE.json').unlink(missing_ok=True)


def require_ready(folder: Path) -> dict:
    folder = Path(folder)
    try:
        if any((folder / marker).exists() for marker in ['INCOMPLETE.json', 'FAILED.json']):
            raise ArtifactError('Run is incomplete or failed. Generate a fresh successful run before prediction.')
        seal = json.loads(_file(folder, 'SUCCESS.json').read_text(encoding='utf-8'))
        if not isinstance(seal, dict):
            raise ArtifactError('Invalid completion document. Prediction blocked.')
        hashes = seal.get('artifacts_sha256')
        if seal.get('version') != 2 or not isinstance(hashes, dict) or not set(REQUIRED_OUTPUTS + EVIDENCE_FILES).issubset(hashes):
            raise ArtifactError('Completion approval is missing or invalid. Generate a fresh run.')
        for name, digest in hashes.items():
            if not isinstance(digest, str) or sha256(_file(folder, name)) != digest:
                raise ArtifactError(f'Artifact changed after completion: {name}. Prediction blocked.')
        manifest = _bindings(folder)
        contract = json.loads((folder / 'dataset_contract.json').read_text(encoding='utf-8'))
        if seal.get('run_id') != manifest.get('run_id') or seal.get('dataset_run_id') != contract.get('run_id'):
            raise ArtifactError('Completion approval belongs to another run. Prediction blocked.')
        if any((folder / marker).exists() for marker in ['INCOMPLETE.json', 'FAILED.json']) or json.loads((folder / 'SUCCESS.json').read_text(encoding='utf-8')) != seal:
            raise ArtifactError('Completion state changed during validation. Prediction blocked.')
        return seal
    except ArtifactError:
        raise
    except (OSError, ValueError, KeyError, TypeError, ContractError) as exc:
        raise ArtifactError(f'Cannot verify completed run: {exc}. Generate a fresh run.') from exc


def model_bytes(folder: Path) -> tuple[dict, bytes]:
    seal = require_ready(folder)
    payload = (Path(folder) / 'model.joblib').read_bytes()
    if hashlib.sha256(payload).hexdigest() != seal['artifacts_sha256']['model.joblib']:
        raise ArtifactError('Model changed while being read. Prediction blocked.')
    return seal, payload
