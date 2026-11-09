DO $$
BEGIN
  IF to_regclass('public.company_onboarding_seeds') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "company_onboarding_seeds") THEN
    ALTER TABLE "company_onboarding_seeds" RENAME TO "archived_company_onboarding_seeds";
  ELSE
    DROP TABLE "company_onboarding_seeds";
  END IF;
END $$;
