import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from gymmi.config import live_config_status, require_live_config

KEY_NAMES = ['GYMMI_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']


@pytest.fixture
def env_file(tmp_path, monkeypatch):
    for name in KEY_NAMES:
        monkeypatch.delenv(name, raising=False)
    return tmp_path / '.env'


def test_missing_model_fails_before_provider_access(env_file):
    status = live_config_status(env_file)
    assert not status['configured']
    assert not status['provider_access_verified']
    with pytest.raises(ValueError, match='GYMMI_MODEL'):
        require_live_config(env_file)


@pytest.mark.parametrize('provider,key', [('openai', 'OPENAI_API_KEY'),
    ('anthropic', 'ANTHROPIC_API_KEY'), ('gemini', 'GEMINI_API_KEY'), ('gemini', 'GOOGLE_API_KEY')])
def test_course_style_dotenv_loads_config_without_exposing_key(env_file, monkeypatch, provider, key):
    # Register changes through monkeypatch so dotenv values are cleaned up too.
    monkeypatch.setenv('GYMMI_MODEL', '')
    monkeypatch.delenv('GYMMI_MODEL')
    monkeypatch.setenv(key, '')
    monkeypatch.delenv(key)
    env_file.write_text(f'GYMMI_MODEL={provider}/example-model\n{key}=test-secret-value\n', encoding='utf-8')
    status = live_config_status(env_file)
    assert status['configured'] and status['credential_configured']
    assert status['provider'] == provider
    assert not status['provider_access_verified']
    assert 'test-secret-value' not in json.dumps(status)
    assert require_live_config(env_file) == f'{provider}/example-model'


def test_terminal_settings_override_dotenv(env_file, monkeypatch):
    monkeypatch.setenv('GYMMI_MODEL', 'anthropic/terminal-model')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'terminal-test-key')
    env_file.write_text('GYMMI_MODEL=openai/file-model\n', encoding='utf-8')
    assert require_live_config(env_file) == 'anthropic/terminal-model'


@pytest.mark.parametrize('model', ['no-provider', 'unknown/example', 'openai/'])
def test_invalid_model_format_is_reported_as_configuration_error(env_file, monkeypatch, model):
    monkeypatch.setenv('GYMMI_MODEL', model)
    assert not live_config_status(env_file)['configured']


def test_missing_key_is_reported_by_name(env_file, monkeypatch):
    monkeypatch.setenv('GYMMI_MODEL', 'openai/example-model')
    with pytest.raises(ValueError, match='OPENAI_API_KEY'):
        require_live_config(env_file)


def test_cli_preflight_does_not_import_or_run_crewai(tmp_path):
    # A tiny copied project has no Flow/data modules: preflight must not need them.
    shutil.copy2('run.py', tmp_path / 'run.py')
    package = tmp_path / 'gymmi'
    package.mkdir()
    (package / '__init__.py').write_text('', encoding='utf-8')
    shutil.copy2('gymmi/config.py', package / 'config.py')
    environment = os.environ.copy()
    for name in KEY_NAMES:
        environment.pop(name, None)
    command = [sys.executable, str(tmp_path / 'run.py'), '--check-live']
    missing = subprocess.run(command, cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=20)
    assert missing.returncode == 2
    assert not json.loads(missing.stdout)['configured']
    (tmp_path / '.env').write_text('GYMMI_MODEL=openai/example-model\nOPENAI_API_KEY=test-secret-value\n', encoding='utf-8')
    configured = subprocess.run(command, cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=20)
    assert configured.returncode == 0
    assert json.loads(configured.stdout)['configured']
    assert 'test-secret-value' not in configured.stdout + configured.stderr
    assert not (tmp_path / 'runs').exists()
    assert not (tmp_path / 'data').exists()
