import { sql, type SQL } from "drizzle-orm";

export type JsonbFieldType = "text" | "jsonb";

/** Reads top-level fields of an object-valued jsonb column with one decompression per row; JSON null reads as SQL NULL. */
export function jsonbRecordFields<T>(
  column: unknown,
  fields: Record<string, JsonbFieldType>,
  project: (field: (name: string) => SQL) => SQL = () => sql`to_jsonb(fields)`,
): SQL<T> {
  const definitions = sql.join(
    Object.entries(fields).map(([name, type]) => sql`${sql.identifier(name)} ${sql.raw(type)}`),
    sql`, `,
  );
  const field = (name: string) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`Unprojected jsonb field: ${name}`);
    return sql`fields.${sql.identifier(name)}`;
  };
  return sql<T>`(select ${project(field)} from jsonb_to_record(${column}) as fields(${definitions}))`;
}
