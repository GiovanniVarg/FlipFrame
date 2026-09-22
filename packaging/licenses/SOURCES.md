# Release license evidence

Reviewed 2026-09-22 against the 93 production package locations in `app/package-lock.json` and installed package versions. Installed versions matched the lock. All standalone LICENSE/COPYING/NOTICE files found in those package roots were present byte-for-byte in the prior `release-build/FlipFrame-Windows-x64/app` stage.

## Supplemental notices

| Package | Exact version | Included evidence | Primary source |
| --- | --- | --- | --- |
| agent-base | 6.0.2 | Full MIT section extracted verbatim from the installed published README.md; the README also remains in node_modules | https://registry.npmjs.org/agent-base/6.0.2 |
| https-proxy-agent | 5.0.1 | Full MIT section extracted verbatim from the installed published README.md; the README also remains in node_modules | https://registry.npmjs.org/https-proxy-agent/5.0.1 |
| @higgsfield/client | 0.2.6 | Exact public package metadata and upstream dependency notices; own full copyright/license notice unresolved | https://registry.npmjs.org/@higgsfield%2fclient/0.2.6 |

Both extracted MIT notice files have SHA-256 `b3681ff73335c04770aa0367aa4ca72e77e5ca55007fc0bcb9d564d00cce20f4`.

The Higgsfield npm metadata identifies source commit `e3f274249962417e21f6566d4eecec6d8491d11c` in https://github.com/higgsfield-ai/higgsfield-js. Its package.json and README declare MIT, but neither the published package nor that source tree includes its own full license/copyright notice. The included upstream THIRD-PARTY-NOTICES.txt is copied from https://raw.githubusercontent.com/higgsfield-ai/higgsfield-js/e3f274249962417e21f6566d4eecec6d8491d11c/THIRD-PARTY-NOTICES.txt and covers the SDK's dependencies, not a substitute license for the SDK itself. No notice was invented. This is a license-evidence gap, not a finding that redistribution is forbidden or proven noncompliant: the published package expressly declares MIT. The verbatim upstream package.json is included alongside provenance and upstream dependency notices. A maintainer-supplied complete own notice would resolve the documentation gap.

## Other verified production notices

Busboy 1.6.0 and streamsearch 1.1.0 have missing license metadata but ship complete Brian White MIT notices; both are retained in the prior stage. Effective observed Node-package license distribution: 88 MIT, 4 ISC, 1 BSD-3-Clause.

The prior stage bundles the full Node v22.21.1 `runtime/node/LICENSE` and Python 3.12.10 `runtime/python/LICENSE.txt`. Preserve these files in subsequent builds. This audit does not establish final ZIP contents: rebuild and verify the final artifact after packaging changes.

The prior stage contains downloaded NumPy, OpenCV, and imageio-ffmpeg packages. It is not the new public artifact. The public build is being changed to acquire those components directly from upstream on first launch; verify their executable/binary payloads are absent from the final ZIP.

No code-signing certificates were found in the CurrentUser/My or LocalMachine/My certificate stores during a metadata-only check. An unsigned preview should be labeled accordingly. Remote signing services and other certificate stores were not inspected.
