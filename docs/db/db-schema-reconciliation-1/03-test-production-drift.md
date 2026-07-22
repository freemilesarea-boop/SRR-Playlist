# 03 — Test / Production Drift

> Machine-readable: `rpc-test-production-comparison.json`.

## Functions
| Drift status | Count |
|---|---|
| MATCH (test=prod) | 0 |
| PRESENT_PROD_ONLY | **31** |
| PRESENT_TEST_ONLY | 0 |
| SIGNATURE_DRIFT | 0 (n/a — test absent) |
| SECURITY_DRIFT | 0 (n/a — test absent) |
| ABSENT_BOTH | 0 |
| UNVERIFIED | 0 |

All 31 exist only in Production → no cross-environment signature/source comparison is possible; the drift is binary (prod-has, test-lacks).

## Tables (dependency)
| Table | Production | Test | Repo |
|---|---|---|---|
| site_notices | ✓ | ✗ | ✗ |
| site_settings | ✓ | ✗ | ✗ |
| support_inquiries | ✓ | ✗ | ✗ |
| support_inquiry_attachments | ✓ | ✗ | ✗ |
| track_ai_predictions | ✓ | ✗ | ✗ |
| clap_recommendations | ✓ | ✓ | ✓ |
| playlist_centroids | ✓ | ✓ | ✓ |

## Interpretation
Several whole features (site notices, site settings, support inquiries, track-AI predictions) were applied **directly to Production** without migrations and without propagating to Test. This is a significant repo↔prod↔test drift requiring table+function+RLS+grant recovery (not functions alone). CLAP curation tables are consistent; only its functions drifted.
