# Windows download preview

Version: **0.1.0-preview.1**, Windows x64, unsigned.

## For users

1. Download the ZIP and its `.sha256` file from the same release.
2. Verify the ZIP's SHA-256 checksum, then extract the whole archive.
3. Open `FlipFrame.exe` inside the extracted folder. Keep its app and runtime folders together.
4. Allow the first setup to download about 88 MB of media tools. Progress appears in the launcher. An interrupted or failed setup can be retried by opening the launcher again.
5. Studio opens in your browser. Missing assistant or video connections open the setup screen. Enter your own keys, or skip to try local features. An empty environment file does not prompt if working configuration is already present elsewhere.

Keys are saved locally in `.env.local`; saved secret values are never returned to the settings screen. Projects and installed tools live under `%LOCALAPPDATA%\FlipFrame`. Preserve that folder when updating. Entering keys does not authorize spending: paid generation also requires a positive allowance and approval in the editor.

After initial setup, cached local media tools work without another download. Remote generation and assistants require internet. Optional tracking and background-selection models have separate setup requirements. CPU-only processing may be slow.

## Building and checking a release

Use `packaging/build-windows.ps1` with a fresh output directory, then `packaging/finalize-windows.ps1` for the checked archive. Inspect their parameters before running. The finalizer writes `release-manifest.json`, the ZIP and its SHA-256 sidecar, rejects private/generated files and bundled media packages, and runs the extracted launcher with an isolated user directory.

Run the application tests and production build, `packaging/test_bootstrap_media.py`, and `packaging/test-public-payload.ps1`. Verify first-launch download, cached startup, interrupted-setup recovery, and an empty-configuration setup screen. Do not include user media, keys, model weights, databases, or downloaded user runtimes in a release.

The manifest records package version, bundled runtime versions and per-file hashes. The checksum detects a changed archive; it is not publisher authentication. A trusted code-signing certificate is not supplied. Test on a separate clean Windows machine before describing the release as broadly supported.

The repository and release visibility are separate from creating a ZIP. A local archive is not automatically a public download. Publish only the new public-preview archive, not an older codec-bundled local build. Preserve [third-party notices](../THIRD_PARTY_NOTICES.md).
