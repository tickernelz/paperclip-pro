import type { UIAdapterModule } from "../types";
import { parseOmpStdoutLine } from "@tickernelz/paperclip-pro-adapter-omp-local/ui";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";

export const ompLocalUIAdapter: UIAdapterModule = {
  type: "omp_local",
  label: "Oh My Pi (OMP)",
  parseStdoutLine: parseOmpStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};
