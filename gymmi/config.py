"""Small .env setup, following the course examples. No provider request is made."""
import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROVIDER_KEYS = {
    'openai': ['OPENAI_API_KEY'],
    'anthropic': ['ANTHROPIC_API_KEY'],
    'gemini': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
}


def live_config_status(env_path=None) -> dict:
    # Existing terminal values take precedence over the local file.
    load_dotenv(env_path or PROJECT_ROOT / '.env', override=False)
    model = os.environ.get('GYMMI_MODEL', '').strip()
    provider, separator, model_name = model.partition('/')
    missing = []
    if not separator or not model_name.strip() or provider not in PROVIDER_KEYS:
        missing.append('GYMMI_MODEL: use provider/model with openai, anthropic or gemini')
    key_names = PROVIDER_KEYS.get(provider, [])
    credentials_set = any(os.environ.get(name, '').strip() for name in key_names)
    if key_names and not credentials_set:
        missing.append(' or '.join(key_names))
    # Return names and booleans only, never API key values.
    return {'configured': not missing, 'provider': provider if provider in PROVIDER_KEYS else None,
        'credential_configured': credentials_set, 'missing': missing,
        'provider_access_verified': False}


def require_live_config(env_path=None) -> str:
    status = live_config_status(env_path)
    if not status['configured']:
        raise ValueError('Live setup incomplete: ' + '; '.join(status['missing']) +
            '. Check the local .env file with python run.py --check-live.')
    return os.environ['GYMMI_MODEL'].strip()
