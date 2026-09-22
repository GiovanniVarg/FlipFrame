# Third-party components

FlipFrame's MIT license applies to its own code. Bundled dependencies retain their original licenses and copyright notices. Do not remove the license files delivered with the runtimes and packages.

## Portable preview inventory

- Node.js: version recorded in release-manifest.json; runtime/node/LICENSE contains Node and bundled-component notices. https://nodejs.org/
- Python 3.12.10 embeddable distribution: runtime/python/LICENSE.txt. https://www.python.org/downloads/release/python-31210/
- Production npm dependencies: exact versions are in app/package-lock.json; original license files remain in app/node_modules. This includes React, Express, Multer and the Higgsfield client and their dependencies.
- NumPy, OpenCV and imageio-ffmpeg: exact installed versions and original notices remain in runtime/python/Lib/site-packages, including their .dist-info license directories. Their bundled native libraries have additional notices.
- imageio-ffmpeg 0.6.0 wraps a separate FFmpeg executable; the wrapper's BSD license does not replace the executable's license.

## FFmpeg binary and redistribution gate

The Windows preview includes imageio-ffmpeg's ffmpeg-win-x86_64-v7.1.exe. Its own version output identifies `7.1-essentials_build-www.gyan.dev`, built with `--enable-gpl --enable-version3`, including libx264 and other third-party libraries. Treat this as a GPL-enabled binary, not as MIT or an LGPL-only FFmpeg build.

Upstream references:
- Wrapper and wheel: https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0
- Binary build provider: https://www.gyan.dev/ffmpeg/builds/
- FFmpeg licensing and redistribution guidance: https://ffmpeg.org/legal.html

This locally assembled preview is not cleared for public binary redistribution. Before publishing the ZIP, assemble and verify the exact corresponding source, build instructions and license texts for this FFmpeg build and its enabled libraries; satisfy the applicable source-distribution requirements. A link to a current upstream repository alone is not evidence that those obligations are met. OpenCV's bundled codec libraries also require this review. Do not publish the preview as a completed compliant binary release based only on this inventory.

## Optional models and services

SAM 2 and automatic background models are not bundled. Their source, weights and downloaded dependencies retain separate terms. Provider accounts, APIs, generated media and user uploads are not licensed by FlipFrame's MIT license.
