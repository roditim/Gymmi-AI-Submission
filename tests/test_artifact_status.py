import json
import shutil
from pathlib import Path

import pytest

from gymmi import artifact_status
from gymmi.artifact_status import ArtifactError, EVIDENCE_FILES, REQUIRED_OUTPUTS, begin, publish, require_ready
from gymmi.contracts import VisitHistory
from gymmi.prediction import predict

BOOKING = VisitHistory(prewk1=1, prewk2=0, prewk3=2, week1=1)


@pytest.fixture
def complete(tmp_path):
    return Path(shutil.copytree('runs/verified', tmp_path / 'complete'))


def test_complete_run_can_predict(complete):
    assert require_ready(complete)['version'] == 2
    assert 0 <= predict(complete, BOOKING) <= 1


@pytest.mark.parametrize('name', REQUIRED_OUTPUTS + EVIDENCE_FILES)
def test_missing_artifact_blocks_before_model_loading(complete, monkeypatch, name):
    import gymmi.prediction as scoring
    (complete / name).unlink()
    monkeypatch.setattr(scoring.joblib, 'load', lambda *a, **k: pytest.fail('Loaded an unapproved model'))
    with pytest.raises(ArtifactError):
        predict(complete, BOOKING)


@pytest.mark.parametrize('name', ['model.joblib', 'features.csv', 'insights.md', 'dataset_contract.json',
    'run_manifest.json', 'feature_validation.json', 'scientist_review.json'])
def test_modified_artifact_blocks_scoring(complete, name):
    with (complete / name).open('ab') as stream:
        stream.write(b'\nchanged')
    with pytest.raises(ArtifactError, match='changed after completion'):
        predict(complete, BOOKING)


@pytest.mark.parametrize('marker', ['INCOMPLETE.json', 'FAILED.json'])
def test_old_success_does_not_override_failure_markers(complete, marker):
    (complete / marker).write_text('{}', encoding='utf-8')
    with pytest.raises(ArtifactError, match='incomplete or failed'):
        require_ready(complete)


def test_legacy_success_manifest_is_insufficient(complete):
    (complete / 'SUCCESS.json').unlink()
    assert json.loads((complete / 'run_manifest.json').read_text(encoding='utf-8'))['success']
    with pytest.raises(ArtifactError):
        require_ready(complete)


def test_partial_publication_cannot_restore_old_success(complete, monkeypatch):
    run_id = require_ready(complete)['run_id']
    begin(complete, run_id)
    assert not (complete / 'SUCCESS.json').exists()
    original = artifact_status.os.replace

    def interrupted(source, target):
        if Path(target).name == 'SUCCESS.json':
            raise OSError('simulated interrupted atomic publication')
        return original(source, target)

    monkeypatch.setattr(artifact_status.os, 'replace', interrupted)
    with pytest.raises(OSError):
        publish(complete, run_id)
    assert (complete / 'INCOMPLETE.json').exists()
    assert not (complete / 'SUCCESS.json.tmp').exists()
    with pytest.raises(ArtifactError):
        require_ready(complete)


def test_seal_from_another_run_and_path_traversal_are_rejected(complete):
    seal_path = complete / 'SUCCESS.json'
    seal = json.loads(seal_path.read_text(encoding='utf-8'))
    seal['run_id'] = 'different-run'
    seal_path.write_text(json.dumps(seal), encoding='utf-8')
    with pytest.raises(ArtifactError, match='another run'):
        require_ready(complete)
    seal['artifacts_sha256']['../outside'] = 'anything'
    seal_path.write_text(json.dumps(seal), encoding='utf-8')
    with pytest.raises(ArtifactError, match='Invalid artifact filename'):
        require_ready(complete)


def test_artifact_swap_during_model_loading_is_rejected(complete, monkeypatch):
    import gymmi.prediction as scoring
    original = scoring.joblib.load

    def swap(stream):
        bundle = original(stream)
        (complete / 'INCOMPLETE.json').write_text('{}', encoding='utf-8')
        return bundle

    monkeypatch.setattr(scoring.joblib, 'load', swap)
    with pytest.raises(ArtifactError, match='incomplete or failed'):
        predict(complete, BOOKING)


def test_change_during_prediction_does_not_return_probability(complete, monkeypatch):
    import numpy as np
    from sklearn.pipeline import Pipeline

    def change(*args, **kwargs):
        (complete / 'features.csv').write_text('replaced', encoding='utf-8')
        return np.array([[0.2, 0.8]])

    monkeypatch.setattr(Pipeline, 'predict_proba', change)
    with pytest.raises(ArtifactError):
        predict(complete, BOOKING)


def test_direct_training_invalidates_previous_approval_before_work(complete):
    from gymmi.boundary import sha256
    from gymmi.scientist import ScientistWorkspace

    def stopped(worker):
        assert not (complete / 'SUCCESS.json').exists()
        with pytest.raises(ArtifactError):
            require_ready(complete)
        raise RuntimeError('deliberately interrupted before fitting')

    worker = ScientistWorkspace(complete / 'clean_data.csv', complete / 'dataset_contract.json',
        complete, sha256(complete / 'dataset_contract.json'), before_train=stopped)
    with pytest.raises(RuntimeError, match='deliberately interrupted'):
        worker.train_compare()
    assert (complete / 'FAILED.json').exists()
    with pytest.raises(ArtifactError):
        predict(complete, BOOKING)


@pytest.mark.parametrize('case', ['missing_seal', 'incomplete', 'corrupt_review', 'corrupt_manifest', 'manifest_structure', 'missing_contract'])
def test_ui_does_not_offer_prediction_for_incomplete_or_old_runs(tmp_path, monkeypatch, case):
    from streamlit.testing.v1 import AppTest
    root = tmp_path / 'runs'
    folder = Path(shutil.copytree('runs/verified', root / 'verified'))
    if case == 'missing_seal': (folder / 'SUCCESS.json').unlink()
    elif case == 'incomplete': (folder / 'INCOMPLETE.json').write_text('{}', encoding='utf-8')
    elif case == 'corrupt_review': (folder / 'scientist_review.json').write_text('not JSON', encoding='utf-8')
    elif case == 'corrupt_manifest': (folder / 'run_manifest.json').write_text('not JSON', encoding='utf-8')
    elif case == 'manifest_structure': (folder / 'run_manifest.json').write_text('{"mode":null,"events":false}', encoding='utf-8')
    else: (folder / 'dataset_contract.json').unlink()
    monkeypatch.setenv('GYMMI_RUNS_DIR', str(root))
    app = AppTest.from_file(Path('app.py').resolve()).run(timeout=60)
    assert not app.exception
    assert not any(button.label == 'חשב הסתברות' for button in app.button)
    assert any('החיזוי חסום' in warning.value for warning in app.warning)


def test_ui_rechecks_artifacts_when_prediction_is_submitted(tmp_path, monkeypatch):
    from streamlit.testing.v1 import AppTest
    root = tmp_path / 'runs'
    folder = Path(shutil.copytree('runs/verified', root / 'verified'))
    monkeypatch.setenv('GYMMI_RUNS_DIR', str(root))
    app = AppTest.from_file(Path('app.py').resolve()).run(timeout=60)
    button = next(button for button in app.button if button.label == 'חשב הסתברות')
    (folder / 'features.csv').write_text('corrupt', encoding='utf-8')
    button.click().run(timeout=60)
    assert not app.exception
    assert not app.metric
    assert not any(button.label == 'חשב הסתברות' for button in app.button)


def test_legacy_completion_version_is_blocked(complete):
    path=complete/'SUCCESS.json'
    seal=json.loads(path.read_text())
    seal['version']=1
    path.write_text(json.dumps(seal))
    with pytest.raises(ArtifactError,match='approval'):
        require_ready(complete)
