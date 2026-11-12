UPDATE "environments"
SET "metadata" = ("metadata" - '_paperclipManagedArchiveToken')
  || jsonb_build_object('_wardmoteManagedArchiveToken', "metadata"->'_paperclipManagedArchiveToken')
WHERE "metadata" ? '_paperclipManagedArchiveToken';--> statement-breakpoint
UPDATE "built_in_managed_resources"
SET "defaults_json" = ("defaults_json" - '_paperclipManagedArchiveToken')
  || jsonb_build_object('_wardmoteManagedArchiveToken', "defaults_json"->'_paperclipManagedArchiveToken')
WHERE "defaults_json" ? '_paperclipManagedArchiveToken';
