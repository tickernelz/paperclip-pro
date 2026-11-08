import {
  EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV,
  prepareEmbeddedPostgresTestTemplate,
} from "@tickernelz/paperclip-pro-db/test-embedded-postgres";

export default async function setup(): Promise<(() => void) | undefined> {
  if (process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV]) return undefined;
  let template: Awaited<ReturnType<typeof prepareEmbeddedPostgresTestTemplate>>;
  try {
    template = await prepareEmbeddedPostgresTestTemplate();
  } catch {
    return undefined;
  }
  process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV] = template.dataDir;
  return () => {
    delete process.env[EMBEDDED_POSTGRES_TEMPLATE_DIR_ENV];
    template.cleanup();
  };
}
