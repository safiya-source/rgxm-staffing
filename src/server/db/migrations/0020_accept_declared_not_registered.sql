-- RGXM decision (2026-11-18): a contractor's "not registered for GST/HST" answer is accepted as
-- declared, without a Finance check. Existing unconfirmed "No" answers are marked accordingly.
-- Their unbatched pay lines waiting for tax review are recalculated with "Refresh pay details".
UPDATE "staff_sensitive"
SET "gst_verification_status" = 'verified',
    "gst_verified_at" = now(),
    "gst_verified_by" = NULL,
    "gst_verification_reference" = 'Contractor declared not registered for GST/HST (accepted as declared; no Finance check needed)'
WHERE "gst_registration_status" = 'no'
  AND "gst_verification_status" = 'unverified';
