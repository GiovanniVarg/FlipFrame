# Pricing and budget accounting

FlipFrame is designed for users who connect their own provider accounts. The video estimate is a provider cost estimate, with no FlipFrame markup in the calculation. A local budget reservation does not transfer money or buy provider credits.

## What the numbers mean

- **Estimated video cost:** the latest estimate for this request. An authenticated numeric provider quote takes priority. When the provider returns a supported pricing formula instead, FlipFrame calculates an estimate and labels its assumptions.
- **Budget buffer:** extra room in the local budget. The current policy reserves twice the estimate: the estimate plus a 100% buffer. This is not a second fee and is not a provider-enforced spending cap.
- **Confirmed charge:** shown only after a recorded billing reconciliation or a supported provider-confirmed free terminal outcome. A completed video alone is not billing evidence. Old reservations remain unchanged until reconciled.

Assistant/LLM provider charges, taxes, account-specific discounts not reflected in a provider quote, hosting, storage and electricity are not invented or silently included in the video estimate. Local selection, composition and playback-copy work do not submit a paid video generation.

## Precision and provenance

`pricing.mjs` centralizes supported token pricing. Formula costs use integer nanodollars internally and round upward by less than one millionth of a dollar for the working USD estimate, rather than rounding each request to a full cent. The interface retains sub-cent amounts.

Video-edit pricing includes the uploaded context and end padding, not just the selected editing interval. Prepared clip dimensions and duration are measured before estimating when the clip is available. Output dimensions and generated duration remain assumptions until the provider produces its result; the UI distinguishes these from measured input. Local preparation dimensions match the actual extraction path.

The pinned formula is a fallback for supported model contracts, not a live universal price catalog. Provider formula descriptions must match the supported contract before submission. Rate or schema changes fail closed instead of guessing. Quotes record their basis, timestamp, dimensions and token rate when available. Numeric account quotes remain authoritative estimates, not confirmed invoices.

A fresh estimate is checked before submission. If it exceeds the approved plan, no generation is submitted. Recovery of an already accepted request reuses its provider result and does not create a second generation.

## Verifying actual charges

The existing operator reconciliation workflow in `operator.mjs` accepts an actual USD amount, terminal outcome and billing evidence. Stop the server before using this maintenance command so only one process writes the workspace. Never put secrets in billing evidence. Reconciliation records the actual cost and releases the corresponding reservation once; it can truthfully record a charge above the estimate.

Public job responses expose only the confirmed amount, outcome and confirmation time, not private evidence notes. A missing charge remains unknown, not zero. Never replace a historical quote with a newly calculated price.

## Provider references

- [Higgsfield billing and estimate contract](https://docs.higgsfield.ai/docs/concepts/billing-and-retention)
- [Seedance video-edit parameters](https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-edit/api-reference)

Maintainers should update the supported pricing contract and regression tests together. Test formula boundaries, portrait/square/landscape preparation, padded duration, numeric quotes, quote increases, retries and billing reconciliation without submitting paid generations.
