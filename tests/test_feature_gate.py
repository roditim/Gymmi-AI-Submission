import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from gymmi.boundary import ContractError, sha256
from gymmi.feature_gate import validate_features
from gymmi.scientist import ScientistWorkspace


@pytest.fixture
def workspace(tmp_path):
    for name in ['clean_data.csv', 'dataset_contract.json']:
        shutil.copy2(Path('runs/verified') / name, tmp_path / name)
    worker = ScientistWorkspace(tmp_path / 'clean_data.csv', tmp_path / 'dataset_contract.json',
        tmp_path, sha256(tmp_path / 'dataset_contract.json'))
    worker.engineer()
    return worker


@pytest.mark.parametrize('case', ['value', 'row_order', 'identifier', 'target', 'split',
    'missing_feature', 'leaked_target', 'nonfinite', 'missing_row', 'fit_metadata', 'duplicate_header'])
def test_corrupt_features_stop_before_any_estimator_fit(workspace, monkeypatch, case):
    from gymmi import scientist
    fits = []

    def forbidden(*args, **kwargs):
        fits.append(True)
        raise AssertionError('Estimator fit reached before the feature gate!')

    for model in [scientist.LogisticRegression, scientist.RandomForestClassifier, scientist.DummyClassifier]:
        monkeypatch.setattr(model, 'fit', forbidden)
    path = workspace.output / 'features.csv'
    frame = pd.read_csv(path, dtype={'record_id': str})
    if case == 'value': frame.iloc[0, 1] += 0.01
    elif case == 'row_order': frame = frame.iloc[::-1]
    elif case == 'identifier': frame.loc[0, 'record_id'] = frame.loc[1, 'record_id']
    elif case == 'target': frame.loc[0, 'attended_next_week'] = 1 - frame.loc[0, 'attended_next_week']
    elif case == 'split': frame.loc[0, 'split'] = 'test' if frame.loc[0, 'split'] != 'test' else 'train'
    elif case == 'missing_feature': frame = frame.drop(columns=frame.columns[1])
    elif case == 'leaked_target': frame['leaked_target'] = frame['attended_next_week']
    elif case == 'nonfinite': frame.iloc[0, 1] = np.inf
    elif case == 'missing_row': frame = frame.iloc[:-1]
    elif case == 'fit_metadata':
        meta = workspace.output / 'feature_metadata.json'
        value = json.loads(meta.read_text(encoding='utf-8'))
        value['preprocessing_fit_record_ids'].append('unapproved-row')
        meta.write_text(json.dumps(value), encoding='utf-8')
    frame.to_csv(path, index=False, float_format='%.17g')
    if case == 'duplicate_header':
        lines = path.read_text(encoding='utf-8').splitlines()
        columns = lines[0].split(',')
        columns[2] = columns[1]
        lines[0] = ','.join(columns)
        path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    # Updating the old checksum/cached producer state cannot bypass reconstruction.
    workspace.features_sha = sha256(path)
    workspace.x = frame.select_dtypes('number').to_numpy()
    with pytest.raises(ContractError, match='Training blocked'):
        workspace.train_compare()
    assert not fits
    assert not (workspace.output / 'model.joblib').exists()


def test_gate_ignores_producer_cache_and_checks_train_only_fit(workspace):
    workspace.pre.fit(workspace.df)
    workspace.x = workspace.pre.transform(workspace.df)
    frame = pd.read_csv(workspace.output / 'features.csv', dtype={'record_id': str})
    frame[workspace.feature_names] = workspace.x
    frame.to_csv(workspace.output / 'features.csv', index=False, float_format='%.17g')
    with pytest.raises(ContractError, match='training-only preprocessing'):
        workspace.validate_features()


def test_feature_file_changed_while_being_validated_is_rejected(workspace, monkeypatch):
    from gymmi import feature_gate
    original = feature_gate.feature_metadata

    def concurrent_write(design, contract_path):
        expected = original(design, contract_path)
        with (workspace.output / 'features.csv').open('ab') as stream:
            stream.write(b'\nchanged after the read')
        return expected

    monkeypatch.setattr(feature_gate, 'feature_metadata', concurrent_write)
    with pytest.raises(ContractError, match='changed during validation'):
        workspace.validate_features()


def test_direct_fresh_trainer_revalidates_saved_inputs(workspace):
    fresh = ScientistWorkspace(workspace.clean_path, workspace.contract_path,
        workspace.output, workspace.approved_contract_sha)
    fresh.train_compare()
    assert (workspace.output / 'model.joblib').is_file()
    report = json.loads((workspace.output / 'feature_validation.json').read_text(encoding='utf-8'))
    assert report['passed'] and report['rows'] == 389
    assert report['features_sha256'] == sha256(workspace.output / 'features.csv')
    assert (workspace.output / 'INCOMPLETE.json').exists()
    assert not (workspace.output / 'SUCCESS.json').exists()


@pytest.mark.parametrize('case', ['feature_values', 'feature_rows', 'feature_leakage'])
def test_flow_injected_feature_failure_is_not_published(tmp_path, case):
    from gymmi.flow import run
    output = tmp_path / 'failed'
    with pytest.raises(ContractError):
        run(output, handoff_dir=Path('runs/verified'), break_case=case)
    manifest = json.loads((output / 'run_manifest.json').read_text(encoding='utf-8'))
    assert not manifest['success']
    assert 'feature_gate_started' in [event['stage'] for event in manifest['events']]
    assert not (output / 'model.joblib').exists()
    assert not (output / 'SUCCESS.json').exists()
    assert (output / 'FAILED.json').exists()


def test_failed_tool_operation_is_not_reexecuted_by_crewai_retries():
    from gymmi.crews import StepTool
    operations = []

    def rejected():
        operations.append('attempt')
        raise ContractError('Feature validation rejected this operation')

    tool = StepTool(name='scientist_train_compare', description='A scoped failing operation',
        operation=rejected, output_dir=Path('.'), receipt={'run_id': 'test', 'crew': 'scientist', 'stage': 'train_compare',
            'status': 'done', 'artifacts': ['model.joblib', 'evaluation_report.md']})
    for _ in range(2):
        with pytest.raises(ContractError):
            tool._run()
    assert operations == ['attempt']
    assert tool.calls == 2 and not tool.completed
