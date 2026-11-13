DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_identity_links' AND column_name = 'paperclip_user_id'
  ) THEN
    ALTER TABLE "chat_identity_links" RENAME COLUMN "paperclip_user_id" TO "wardmote_user_id";
  END IF;
END $$;
