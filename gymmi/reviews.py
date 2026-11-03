"""Evidence-bound agent notes. Numeric checks do not prove qualitative reasoning."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr

from .contracts import StageReceipt


class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    evidence_key: str
    value: StrictBool | StrictInt | StrictFloat | StrictStr


class AgentNote(BaseModel):
    model_config = ConfigDict(extra='forbid')
    receipt: StageReceipt
    summary: str = Field(min_length=40, max_length=1600)
    findings: list[str] = Field(min_length=2, max_length=5)
    cautions: list[str] = Field(min_length=1, max_length=5)
    claims: list[Claim] = Field(min_length=2, max_length=8)


class AnalystNote(AgentNote):
    """Interpretation of cleaning, descriptive evidence or handoff policy."""


class ScientistNote(AgentNote):
    """Interpretation of model inputs, comparison evidence or intended use."""


def _flatten(obj: dict, prefix: str = '') -> dict:
    result = {}
    for key, value in obj.items():
        path = f'{prefix}.{key}' if prefix else str(key)
        if isinstance(value, dict):
            result.update(_flatten(value, path))
        elif isinstance(value, (str, int, float, bool)):
            result[path] = value
    return result


def stage_evidence(output: Path, stage: str) -> dict:
    """Read only explicitly enumerated summaries, never an agent-selected path."""
    def read(name):
        return json.loads((output / name).read_text(encoding='utf-8'))

    if stage in {'ingest', 'explore'}:
        p = read('data_profile.json')
        return _flatten({k: p[k] for k in ['rows', 'attendance_rate', 'target_counts',
            'missing_clean', 'record_id_duplicates', 'feature_duplicates_excluding_id_and_target']})
    if stage == 'publish':
        c = read('dataset_contract.json')
        return _flatten({'rows': c['rows'], 'license_status': c['license_status'],
            'public_distribution_approved': c['public_distribution_approved'],
            'target': c['split']['target'], 'selection_metric': c['split']['selection_metric']})
    if stage == 'engineer':
        m = read('feature_metadata.json')
        return {'fit_rows': m['fit_rows'], 'target': m['target'],
            'transformed_feature_count': len(m['model_features']),
            'numeric_input_count': len(m['input_numeric']),
            'categorical_input_count': len(m['input_categorical'])}
    m = read('metrics.json')
    return _flatten({k: m[k] for k in ['selected_model', 'selection_metric', 'split_sizes',
        'chronological_or_member_split', 'refit_on_validation_or_test', 'validation', 'test']})


def validate_note(task_output: Any, model: type[AgentNote], receipt: dict,
                  evidence: dict, completed: bool) -> AgentNote:
    if not completed:
        raise ValueError('Required scoped tool did not complete; analysis cannot be accepted.')
    parsed = getattr(task_output, 'pydantic', None)
    note = model.model_validate(parsed.model_dump()) if parsed is not None else model.model_validate_json(task_output.raw)
    if note.receipt.model_dump() != receipt:
        raise ValueError('Receipt identity or artifact list changed.')
    keys = [claim.evidence_key for claim in note.claims]
    if len(keys) != len(set(keys)):
        raise ValueError('Cite distinct evidence keys, not duplicate claims.')
    for claim in note.claims:
        if claim.evidence_key not in evidence:
            raise ValueError(f'Unknown evidence key: {claim.evidence_key}')
        expected = evidence[claim.evidence_key]
        # Exact JSON scalar type/value avoids accepting True as the number one.
        if type(claim.value) is not type(expected) or claim.value != expected:
            raise ValueError(f'Unsupported value for {claim.evidence_key}; copy its exact evidence value.')
    named_prose = [('summary', note.summary)] + [
        (f'findings[{index}]', text) for index, text in enumerate(note.findings)] + [
        (f'cautions[{index}]', text) for index, text in enumerate(note.cautions)]
    prose = [text for _, text in named_prose]
    if any(not text.strip() for text in prose):
        raise ValueError('Analysis and cautions must be nonempty.')
    for field, text in named_prose:
        # Digits inside standard technical names are not measured quantities.
        narrative = re.sub(r'\b(?:F1|SHA-?256|prewk[123]|week[12]|one-hot)\b', '', text, flags=re.I)
        number_words = r'\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b'
        if re.search(r'\d|%|'+number_words, narrative, flags=re.I):
            raise ValueError(f'{field} contains quantitative text: {text[:180]!r}. '
                'Put all quantities in claims, including spelled-out counts. Keep prose qualitative.')
    for text in prose:
        remaining = text.lower().replace('overfitting cannot be assessed from validation/test similarity alone.', '')
        if 'overfitting' in remaining or re.search(r'generalizes? (?:well|reliably)|well.calibrated', remaining):
            raise ValueError('Unsupported generalization/overfitting/calibration inference. '
                'Use: Overfitting cannot be assessed from validation/test similarity alone.')
    if any(re.search(r'guarantee[sd]?|proves? causation|production.ready|fairness (?:is )?proven', text, re.I) for text in prose):
        raise ValueError('Unsupported guarantee, causality, production or fairness claim.')
    return note


def note_guardrail(tool, model):
    attempts = 0
    def guard(task_output):
        nonlocal attempts
        attempts += 1
        try:
            note = validate_note(task_output, model, tool.receipt, tool.evidence, tool.completed)
            passed, result = True, note.model_dump_json()
        except (ValueError, TypeError) as exc:
            passed, result = False, f'Grounding check failed: {exc}. Correct the JSON using only tool evidence.'
        output = getattr(tool, 'output_dir', None)
        if output is not None:
            record = {'utc': datetime.now(timezone.utc).isoformat(), 'crew': tool.receipt['crew'],
                'stage': tool.receipt['stage'], 'attempt': attempts, 'accepted': passed,
                'error': None if passed else result, 'candidate': task_output.raw}
            with (output / 'review_validation.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + '\n')
        return passed, result
    return guard


STAGE_FINDINGS = {
    'ingest': ['Missing inputs must remain explicit until training-only preprocessing.',
               'Duplicate row identifiers and repeated feature patterns are different quality checks.'],
    'explore': ['Observed attendance describes this file rather than future demand.',
                'Observed associations cannot establish a causal benefit from reminders.'],
    'publish': ['The target must remain outside the model input features.',
                'The contract records a handoff policy rather than proof of original collection quality.'],
    'engineer': ['Training-only preprocessing limits information transfer from evaluation rows.',
                 'Grouping identical inputs does not establish independence between people.'],
    'train_compare': ['Model selection uses validation evidence rather than the final test ranking.',
                     'The majority reference makes accuracy alone inadequate for comparison.'],
    'card': ['Predictions support an educational demonstration rather than operational cancellation.',
             'Saved holdout results are descriptive because earlier development exposed the holdout.'],
}


def offline_note(tool) -> dict:
    """Author-written fixture, explicitly not generated reasoning or live evidence."""
    stage = tool.receipt['stage']
    return {'receipt': tool.receipt,
        'summary': 'Offline author-written analysis fixture grounded in the scoped tool evidence; no live reasoning is claimed.',
        'findings': list(STAGE_FINDINGS[stage]),
        'cautions': ['CC BY attribution is required; future generalization and person independence remain unproven.'],
        'claims': [{'evidence_key': key, 'value': value} for key, value in list(tool.evidence.items())[:2]]}


def publish_notes(workspace, kind: str, notes: list[AgentNote], live: bool) -> None:
    from .util import write_json
    mode = 'live_llm' if live else 'offline_author_written_fixture'
    write_json(workspace.output / f'{kind}_review.json', {'mode': mode,
        'semantic_review_required': True, 'notes': [n.model_dump() for n in notes]})
    # Machine-generated tables and the contract stay unchanged. Only append prose.
    targets = ['insights.md'] if kind == 'analyst' else ['evaluation_report.md', 'model_card.md']
    for name in targets:
        chosen = notes if kind == 'analyst' else [n for n in notes if n.receipt.stage == ('card' if name == 'model_card.md' else 'train_compare')]
        with (workspace.output / name).open('a', encoding='utf-8') as stream:
            stream.write(f'\n\n## Structured agent review ({mode})\n')
            stream.write('Qualitative statements still require human review. Numeric claims are checked against scoped evidence.\n')
            for note in chosen:
                stream.write(f'\n### {note.receipt.stage}\n{note.summary}\n')
                for line in note.findings + note.cautions:
                    stream.write(f'- {line}\n')
                for claim in note.claims:
                    stream.write(f'- Evidence `{claim.evidence_key}`: `{json.dumps(claim.value)}`\n')
