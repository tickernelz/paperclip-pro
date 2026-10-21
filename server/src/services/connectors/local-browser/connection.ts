export function isLocalBrowserConnection(connection: {
  transport: string;
  config?: Record<string, unknown>;
}): boolean {
  return (
    connection.transport === "rest_api" &&
    connection.config?.sourceTemplateKey === "local-browser"
  );
}
