# Third-party components

FlipFrame's MIT license applies to its own code. Dependencies keep their original licenses and copyright notices. Preserve the notices delivered with runtimes and packages.

## Windows public preview

- Node.js: exact version in `release-manifest.json`; notices in `runtime/node/LICENSE`.
- Python 3.12.10 embeddable distribution: notices in `runtime/python/LICENSE.txt`. This is a pinned runtime, not a claim that it is the newest Python security release.
- Production npm packages: exact versions in `app/package-lock.json`; original notices remain in `app/node_modules`.
- Supplemental published notices and provenance are in `packaging/licenses`, including [the evidence inventory](packaging/licenses/SOURCES.md).

The published Higgsfield client 0.2.6 declares MIT but does not include its own complete copyright/license notice. The inventory retains its exact upstream metadata and dependency notices without inventing an attribution. This is an upstream documentation gap, not a determination that redistribution is forbidden or proven compliant.

## Media tools downloaded on first launch

The public ZIP does **not** bundle NumPy, OpenCV, imageio-ffmpeg wheels, their installed packages, or their codec binaries. The launcher downloads pinned official PyPI wheels directly into the user's private runtime: NumPy 2.2.6, opencv-python-headless 5.0.0.93, and imageio-ffmpeg 0.6.0. Exact URLs, sizes and SHA-256 values are recorded in `packaging/bootstrap_media.py`. Installed packages retain their upstream notices, including `.dist-info` license directories.

The imageio-ffmpeg wrapper's BSD license does not replace the separate FFmpeg executable's license. Its Windows FFmpeg build enables GPL components, including libx264. OpenCV also brings native third-party components. If you redistribute the downloaded runtime or make a different all-inclusive ZIP, review and satisfy the applicable source and notice obligations for those exact binaries first. A link to an unrelated current source tree is not proof that corresponding-source obligations are met.

Upstream references:

- https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0
- https://www.gyan.dev/ffmpeg/builds/
- https://ffmpeg.org/legal.html
- https://pypi.org/project/opencv-python-headless/5.0.0.93/
- https://pypi.org/project/numpy/2.2.6/

Older locally assembled ZIPs containing media binaries are superseded; they are not the public preview described here.

## Optional models and services

SAM 2 and automatic background models are not bundled. Their code, weights and downloaded dependencies retain separate terms. Provider services, generated media and user uploads are not licensed by FlipFrame's MIT license. This inventory documents the package composition; it is not a blanket legal clearance for every downstream redistribution.
