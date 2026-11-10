-- Contractor approval is now recorded automatically when someone accepts the Independent Contractor
-- Agreement. Backfill it once for people who already accepted before this change. Anyone who has any
-- approval history (current or revoked by RGXM) is left alone, as are erased profiles.
INSERT INTO "contractor_approvals" ("staff_id", "approved_by", "approved_on", "notes")
SELECT DISTINCT ON (a."staff_id")
  a."staff_id",
  a."user_id",
  (a."accepted_at" AT TIME ZONE 'America/Toronto')::date,
  'Recorded automatically when they accepted the Independent Contractor Agreement (version ' || a."version" || ').'
FROM "staff_acceptances" a
JOIN "staff_profiles" p ON p."id" = a."staff_id"
WHERE a."kind" = 'contractor_terms'
  AND a."user_id" IS NOT NULL
  AND p."anonymized_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "contractor_approvals" c WHERE c."staff_id" = a."staff_id")
ORDER BY a."staff_id", a."accepted_at";
