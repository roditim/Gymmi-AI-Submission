# Development

The production application is docs/app: buildless HTML, CSS and JavaScript. Serve it with python -m http.server 8520 --directory docs/app, or any static HTTP server. The GitHub Pages source is main:/docs, so the app is at /Gymmi-AI-Submission/app/ and the presentation is at the repository Pages root.

Open Gymmi.code-workspace in Cursor. Use a branch and real PR. Test user behavior with tests/browser_mvp.cjs. Playwright is an optional development tool, not a runtime dependency. No credentials, backend service or Python package installation is needed by visitors.

The earlier app.py, run.py, gymmi/ and artifacts/weekly-* are a separate optional research lab. requirements.txt and the historical pytest checks belong to that lab. Its visit target is not workout completion. Keep original sealed artifacts unchanged. Historical execution records describe their captured runs rather than the current submission state.

The local synthetic-completion experiment is preserved separately; it is not a production dependency. The new instructor clarification requires public production and makes CrewAI/ML optional. Do not reintroduce a proxy target or claim synthetic accuracy establishes value for real users.
