# FlipFrame local agent API — version 1

Use this API to operate the editor from an agent running on the same computer.
The app must be running in local mode. Default base URL:
`http://127.0.0.1:8780/api/agent/v1`.

## Connect

In Studio > Settings > Agent access, enable access and copy the one-time token.
Store it privately in the calling agent's secret store. Send
`Authorization: Bearer <token>` with every request. Never put the token in a URL,
source file, transcript or prompt. Regenerating or disabling access invalidates
the previous token. This token can access local projects and request enabled
paid operations; give it only to an agent you trust. It cannot retrieve provider
keys or change application settings. Same-machine processes already have the
user's OS permissions; this is not an OS security sandbox.

Start with `GET /discovery`. It lists the exact supported methods and paths.
Paths below are relative to the versioned base URL. JSON requests require
`Content-Type: application/json`. Multipart uploads must let the HTTP client set
the boundary. No endpoint accepts arbitrary shell commands or filesystem paths.

## Complete an edit

1. `GET /projects` lists projects. `GET /projects/{id}` gives duration, dimensions,
   revisions and `activeRevisionId`. Times are seconds. Read the current revision
   before making a plan; don't reuse an old revision after another edit.
2. If needed, `POST /projects` with multipart field `file` imports a local video.
   Maximum source: 2 GiB and 60 minutes. Normalization may take time; keep the
   connection open. Do not blindly retry an interrupted import; inspect projects.
3. `POST /projects/{id}/conversation` creates a validated plan:
   ```json
   {
     "text": "Mute the sound from 1 to 3 seconds",
     "baseRevisionId": "CURRENT_REVISION_ID",
     "start": 1,
     "end": 3,
     "idempotencyKey": "UNIQUE_UUID_FOR_THIS_REQUEST"
   }
   ```
   Read `requestedPlanId`, then locate that plan in `plans`. A conversation
   response is not evidence that an edit ran. `needs_input` means resolve the
   missing input first. Unsupported requests must be clarified with the user.
4. `POST /projects/{id}/conversation/plans/{planId}/execute` with:
   ```json
   {"baseRevisionId": "CURRENT_REVISION_ID"}
   ```
   The plan ID prevents duplicate execution. Reuse it when recovering a lost
   response. Never create a new paid plan merely because a request timed out.
   Cloud plans require the user's cost approval and the configured server budget.
   The API does not supply independent evidence of human approval: the calling
   agent is responsible for obtaining it before executing paid work.
5. If a `job` is returned, poll `GET /jobs/{id}` every 2–4 seconds. `completed`
   contains the result; `failed`, `canceled` and `unknown` are not successful.
   Unknown provider acceptance must be reconciled, not resubmitted.
   `POST /jobs/{id}/cancel` cancels queued local work or active object tracking.
   Cancellation is asynchronous; wait for the final canceled state.
6. Review the candidate in the studio with the user. Only after approval call
   `POST /projects/{id}/apply` with `candidateId` and current `baseRevisionId`.
   Applying creates a new revision; the source remains intact. Existing jobs and
   conversation plans are readable through the matching project GET routes.
7. Read the updated project. Its active revision's `url` is the local media URL
   for playback/download (resolve against the app origin, not the API prefix).

## Precise object edits

A text model cannot establish that a mask follows the correct object. Select and
review the region in the studio before an object edit. Discovery exposes the
editor's segment/track routes for specialized clients, but they are not a promise
of autonomous visual understanding. Tracking is limited to 10 seconds per range.
The execute endpoint accepts the editor's reviewed `masks`, `scope`,
`visibleRanges`, and `reviewed: true`. Do not invent these values or claim a review
that did not happen. For the exact mask geometry contract see `domain.mjs`
(`validateEdit`) and the existing editor request format. Prefer the studio for
selection until your client implements and visually validates that contract.

## Generate a new video

`POST /originals` creates a draft using `prompt`, `duration` (5 or 10 seconds), and `aspectRatio` (`16:9`, `9:16`,
or `1:1`). Output is currently fixed at 720p with generated audio. Example:
```json
{"prompt":"A red mug on a wooden table, locked camera", "duration":5, "aspectRatio":"16:9"}
```
Read the returned draft; `POST /originals/{id}/review` obtains a cost estimate.
After the user approves it, `POST /originals/{id}/generate` starts work.
Poll `GET /originals/{id}` until completed, then use its `projectId` for edits.
Budget or capability errors mean stop and report the limitation; do not change
settings or bypass the budget. No provider key is needed by the calling agent.

## Reasoning providers and video adapters

Studio Settings supports Jev/TypeSafe, OpenAI Chat Completions-compatible services,
Anthropic Messages, and Google Gemini. Select the protocol, model ID and API key.
OpenAI-compatible base URLs include the API prefix (usually `/v1`). Local HTTP
servers on loopback can be used without a key. Hosted services require HTTPS.
A provider may impose model-specific restrictions; adapter support is not a claim
that every model has been live-tested. Change the key when switching providers.

Video generation currently uses the implemented Higgsfield adapter. Arbitrary
video providers cannot be enabled by entering a name: they need an adapter for
pricing, submission, polling, output validation and declared capabilities.
`model-connections.mjs` documents that extension contract.

App-managed settings are stored in ignored `.local-settings/` files, applied over
existing env defaults at startup. Existing `.env.local` keys remain intact.
Blank key inputs preserve saved credentials. Settings are local-only and secrets
are never returned by the settings read endpoint. Protect this folder as you
would your env files; values are local plaintext, not an encrypted vault.

## Errors and retries

Always check the HTTP status and JSON `error`. On a stale revision, reread the
project and ask for a new plan. Retry conversation requests only with the same
idempotency key and identical body. Do not retry import, apply, or generation
blindly. HTTP 401 means reconnect with a valid agent token; 403 means mode/origin
is blocked; 404 means the route or resource isn't available. Existing editor
validation errors may use HTTP 400. Report actual outcomes, not expected ones.

## Background replacement

Use the editor's Background mode to keep a selected foreground object while
changing the surrounding scene. The foreground mask supports `holes`, an array
of normalized polygon rings inside its outer `points`. Holes represent background
visible through the object and are excluded from foreground protection.

A conversation request can use `intent: "background"` and an instruction such as
"Change the background to underwater." Execution requires reviewed masks on every
visible frame, plus `reviewed: true`, `scope`, and optional `visibleRanges`.
Tracking is limited to 10 seconds per edit. Gaps keep the original frame.

Use Include/Exclude clicks to correct openings, track and inspect the selection,
then review the cost and candidate. The local compositor copies original decoded
foreground pixels and audio; generated background quality and mask accuracy still
need visual review. This does not relight or refract the preserved foreground.
Complex cavities containing disconnected foreground islands are conservatively
kept filled by the polygon conversion and may need a different selection; this is
not general alpha matting for transparent or semi-transparent objects.

## Automatic or polygon selection

Background step 1 offers Auto background, Click object, and Draw around object.
A polygon is a rough guide: draw three or more corners, then choose Find edges
with SAM to create a reviewable object selection. It does not automatically approve
or generate an edit.

Auto background uses BiRefNet-General-Lite through rembg2.0.67 and CPU ONNX Runtime
1.22.1. It guesses the main foreground object on the paused frame; check it before
using SAM to follow it through the clip. Multiple objects, transparent materials
and ambiguous foreground may require manual selection. It is learned image
segmentation, not a rule that can always infer creative intent.

Install explicitly using `.segmentation-env/Scripts/python.exe setup_auto_background.py`
on Windows (use `.segmentation-env/bin/python` elsewhere). Setup downloads the
upstream model with checksum verification and writes a readiness marker. Inference
uses only the local model and never silently downloads one. The automatic detector
runs on CPU; SAM continues to honor the selected processing device.

Agents can POST `/projects/{id}/auto-background` with `baseRevisionId` and `time`
under the agent API prefix. The returned selection job can be polled/canceled like
other selection jobs. Returned outlines require review; this is not generation.

Model sources: https://github.com/ZhengPeng7/BiRefNet and
https://github.com/danielgatis/rembg/tree/v2.0.67 (MIT). Model weights are stored in
ignored `.segmentation/background-models/`, not committed to the repository.

## Pricing and billing

See [PRICING.md](PRICING.md) for estimate provenance, precision, budget holds and reconciliation. Treat `quote.estimatedUsd` as an estimate, `quote.reservedUsd` as local budget allowance, and `confirmedCharge.actualUsd` as a reconciled charge only when present. Never infer a zero or final charge from a missing field or a completed video. A resumed accepted request must reuse the existing request, not submit a second generation.
