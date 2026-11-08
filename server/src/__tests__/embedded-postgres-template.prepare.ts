import { prepareEmbeddedPostgresTestTemplate } from "@tickernelz/paperclip-pro-db/test-embedded-postgres";

const template = await prepareEmbeddedPostgresTestTemplate();
process.stdout.write(`\n${JSON.stringify({ dataDir: template.dataDir })}\n`);
process.exit(0);
