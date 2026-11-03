import copy
import json
from types import SimpleNamespace

import pytest

from gymmi.reviews import AnalystNote, note_guardrail, offline_note, validate_note


@pytest.fixture
def tool():
    return SimpleNamespace(completed=True, evidence={'rows': 389, 'attendance_rate': 0.3},
        receipt={'run_id': 'test-run', 'crew': 'analyst', 'stage': 'ingest',
                 'status': 'done', 'artifacts': ['clean_data.csv']})


def output(payload, structured=False):
    return SimpleNamespace(raw=json.dumps(payload),
        pydantic=AnalystNote.model_validate(payload) if structured else None)


@pytest.mark.parametrize('structured', [False, True])
def test_raw_and_pydantic_notes_use_same_grounding_gate(tool, structured):
    payload = offline_note(tool)
    note = validate_note(output(payload, structured), AnalystNote, tool.receipt, tool.evidence, True)
    assert note.claims[0].value == 389
    assert 'Offline author-written' in note.summary


@pytest.mark.parametrize('case', ['invented_value', 'unknown_key', 'duplicate_claim',
    'changed_receipt', 'numbers_in_prose', 'empty_finding', 'guarantee', 'extra_rule', 'boolean_as_number'])
def test_unsupported_notes_fail_closed(tool, case):
    payload = copy.deepcopy(offline_note(tool))
    if case == 'invented_value': payload['claims'][0]['value'] = 9999
    elif case == 'unknown_key': payload['claims'][0]['evidence_key'] = 'unmeasured_roi'
    elif case == 'duplicate_claim': payload['claims'][1] = payload['claims'][0]
    elif case == 'changed_receipt': payload['receipt']['run_id'] = 'different-run'
    elif case == 'numbers_in_prose': payload['findings'][0] = 'Attendance will improve by 20%.'
    elif case == 'empty_finding': payload['findings'][0] = '   '
    elif case == 'guarantee': payload['findings'][0] = 'This model guarantees reliable attendance.'
    elif case == 'extra_rule': payload['contract_changes'] = {'target': 'record_id'}
    else: payload['claims'][0]['value'] = True
    passed, repair = note_guardrail(tool, AnalystNote)(output(payload))
    assert not passed
    assert 'Grounding check failed' in repair


def test_missing_tool_and_malformed_json_are_not_accepted(tool):
    guard = note_guardrail(tool, AnalystNote)
    assert not guard(SimpleNamespace(raw='not JSON', pydantic=None))[0]
    tool.completed = False
    passed, repair = guard(output(offline_note(tool)))
    assert not passed and 'did not complete' in repair


def test_successful_guard_returns_validated_json(tool):
    passed, raw = note_guardrail(tool, AnalystNote)(output(offline_note(tool)))
    assert passed
    assert AnalystNote.model_validate_json(raw).receipt.run_id == 'test-run'


def test_technical_names_are_allowed_but_measured_scores_are_checked(tool):
    note = offline_note(tool)
    note['findings'][0] = 'F1 is a classification score; SHA256 identifies file changes.'
    assert note_guardrail(tool, AnalystNote)(output(note))[0]
    note['findings'][0] = 'F1 is 0.99 and proves the model works.'
    passed, repair = note_guardrail(tool, AnalystNote)(output(note))
    assert not passed and 'findings[0]' in repair


def test_validation_attempts_are_saved_for_live_diagnostics(tool, tmp_path):
    tool.output_dir = tmp_path
    guard = note_guardrail(tool, AnalystNote)
    note = offline_note(tool)
    note['summary'] = 'The source contains 9999 rows and is ready for production.'
    assert not guard(output(note))[0]
    assert guard(output(offline_note(tool)))[0]
    attempts = [json.loads(line) for line in (tmp_path / 'review_validation.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [entry['accepted'] for entry in attempts] == [False, True]
    assert [entry['attempt'] for entry in attempts] == [1, 2]
    assert 'summary' in attempts[0]['error']


@pytest.mark.parametrize('live', [False, True])
def test_model_card_discloses_selected_execution_mode(tmp_path, live):
    import shutil
    from pathlib import Path
    from gymmi.boundary import read_contract, sha256
    from gymmi.scientist import ScientistWorkspace
    for name in ['clean_data.csv', 'dataset_contract.json', 'metrics.json']:
        shutil.copy2(Path('runs/verified') / name, tmp_path / name)
    worker = ScientistWorkspace(tmp_path / 'clean_data.csv', tmp_path / 'dataset_contract.json',
        tmp_path, sha256(tmp_path / 'dataset_contract.json'), live=live)
    worker.contract = read_contract(worker.contract_path)
    worker.card()
    text = (tmp_path / 'model_card.md').read_text(encoding='utf-8')
    assert ('Live LLM mode was selected' in text) == live
    assert ('author-written notes' in text) == (not live)


def test_live_completion_requires_both_requested_crews(tmp_path):
    from gymmi.flow import GymmiFlow
    folder = tmp_path / 'partial'
    flow = GymmiFlow(folder, raw_path=tmp_path / 'unused.csv', live=True)
    flow.events = [{'crew': 'analyst', 'mode': 'live_llm', 'completed_tasks': 3}]
    flow.manifest(False)
    assert not json.loads((folder / 'run_manifest.json').read_text(encoding='utf-8'))['live_llm_completed']
    flow.events.append({'crew': 'scientist', 'mode': 'live_llm', 'completed_tasks': 3})
    flow.manifest(False)
    assert json.loads((folder / 'run_manifest.json').read_text(encoding='utf-8'))['live_llm_completed']


def test_invalid_agent_analysis_stops_flow_before_consumer(tmp_path, monkeypatch):
    from gymmi import crews
    from gymmi.analyst import AnalystWorkspace
    from gymmi.flow import run

    original = crews.offline_note
    attempts = []

    def synthetic_ingest(workspace):
        # No source dataset is needed to exercise the agent-output trust boundary.
        (workspace.output / 'clean_data.csv').write_text('record_id,attended_next_week\na,0\nb,1\n', encoding='utf-8')
        (workspace.output / 'data_profile.json').write_text(json.dumps({
            'rows': 2, 'attendance_rate': 0.5, 'target_counts': {'0': 1, '1': 1},
            'missing_clean': {}, 'record_id_duplicates': 0,
            'feature_duplicates_excluding_id_and_target': 0}), encoding='utf-8')
        return ['clean_data.csv']

    def invent_claim(scoped_tool):
        note = original(scoped_tool)
        if scoped_tool.receipt['stage'] == 'ingest':
            note['claims'][0]['value'] = 'invented'
            attempts.append(scoped_tool.calls)
        return note

    monkeypatch.setattr(crews, 'offline_note', invent_claim)
    monkeypatch.setattr(AnalystWorkspace, 'ingest', synthetic_ingest)
    destination = tmp_path / 'bad-analysis'
    # CrewAI raises a plain Exception when the bounded task guardrail is exhausted.
    with pytest.raises(Exception, match='Task failed guardrail validation after 1 retries'):
        run(destination, raw_path=tmp_path / 'unused-raw.csv')
    manifest = json.loads((destination / 'run_manifest.json').read_text(encoding='utf-8'))
    assert not manifest['success']
    assert not any(e['stage'] == 'scientist_crew_started' for e in manifest['events'])
    assert not (destination / 'model.joblib').exists()
    assert len(attempts) == 2  # Initial response plus one bounded retry.
    assert attempts == [1, 1]  # Retry does not repeat the cleaning operation.


@pytest.mark.parametrize('claim', [
    'The dataset contains one thousand records.',
    'Similar validation and test scores suggest limited overfitting.',
    'This model generalizes well to new clubs.',
])
def test_semantic_regressions_are_rejected(tool, claim):
    note=offline_note(tool)
    note['findings'][0]=claim
    assert not note_guardrail(tool,AnalystNote)(output(note))[0]


def test_explicit_uncertainty_and_visit_feature_names_are_allowed(tool):
    note=offline_note(tool)
    note['findings'][0]='Overfitting cannot be assessed from validation/test similarity alone.'
    note['findings'][1]='prewk1 and week1 are source field names, not causal evidence.'
    assert note_guardrail(tool,AnalystNote)(output(note))[0]
