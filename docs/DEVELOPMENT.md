# Development

Use Python 3.12 and requirements.txt. Open Gymmi.code-workspace in Cursor. Git belongs to the folder; Cursor detects the same repository. Authenticate GitHub with your own account for pushes.

Generate runs/verified once with `python run.py --download --output runs/verified`, then `python -m pytest -q`. Choose a fresh output directory for another run. The tests use this generated fixture. The app can also read the versioned artifacts if no local runs exist. `.env`, raw downloads and virtual environments are ignored.

This public repository starts with a reviewed export of earlier private project work. Its commit history begins on the export date; no earlier work or independent collaboration is fabricated. Do not import the private repository history or course materials. The active source is the attributed Zenodo weekly-visit study; old Fitness Class data has no established grant and is excluded.

Make a branch, change something you understand, run checks, commit and open a PR. A PR by the same student is a reviewable change, not independent peer review. The CI example in docs/ci-tests.example.yml needs no API key, but it is not active: the publishing credential lacks workflow scope. Local export verification passed all 112 tests. Live runs use your local provider key and can cost money.
