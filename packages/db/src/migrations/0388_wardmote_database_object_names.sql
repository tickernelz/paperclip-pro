DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_identity_links' AND column_name = 'paperclip_user_id'
  ) THEN
    ALTER TABLE "chat_identity_links" RENAME COLUMN "paperclip_user_id" TO "wardmote_user_id";
  END IF;
  IF to_regprocedure('paperclip_bump_issue_status_version()') IS NOT NULL THEN
    ALTER FUNCTION paperclip_bump_issue_status_version() RENAME TO wardmote_bump_issue_status_version;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'paperclip_issue_status_version_trigger' AND tgrelid = to_regclass('issues')) THEN
    ALTER TRIGGER paperclip_issue_status_version_trigger ON "issues" RENAME TO wardmote_issue_status_version_trigger;
  END IF;
  IF to_regprocedure('paperclip_keep_operation_privacy_sources()') IS NOT NULL THEN
    ALTER FUNCTION paperclip_keep_operation_privacy_sources() RENAME TO wardmote_keep_operation_privacy_sources;
  END IF;
END $$;
