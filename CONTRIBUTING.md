# Contributing

Use the source setup in README.md. Keep changes focused and describe their user-visible behavior. Run `npm test` and `npm run build` from `app/`; run the relevant Python tests when changing media processing. Hardware-specific/model tests require optional model installation.

Never commit credentials, `.env.local`, `.local-settings`, user media, project databases, model weights or local logs. Use synthetic fixtures and mocked provider responses. Paid generations are not required for normal tests and must never run automatically in CI.

Preserve originals, request idempotency, ownership checks and approval of paid work. Keep preview copies separate from masters. Document new provider contracts, pricing assumptions and limitations, and include regression tests for failures and recovery.

Before a Windows release, rebuild from the packaging script, inspect the allowlisted manifest and checksums, verify third-party notices and test the extracted package in a fresh user profile without developer tools. Do not bundle your local project or credentials.
