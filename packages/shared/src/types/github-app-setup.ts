export type GitHubAppOwner = {
  ownerType: "personal" | "organization";
  ownerLogin?: string;
};
export type GitHubAppRegistrationInput = GitHubAppOwner & { name: string };
export type GitHubAppWizardState = {
  endpointId: string;
  state:
    | "create"
    | "install"
    | "identity"
    | "verify"
    | "connected"
    | "recovery";
  registration?: {
    registrationUrl: string;
    manifest: Record<string, unknown>;
    expiresAt: string;
  };
  installationUrl?: string;
  identity?: { githubUserId: string; login: string; avatarUrl: string | null };
  identityLinked?: boolean;
  identityMethod?: "dedicated_app" | "existing_connection";
  verification?: {
    ready: boolean;
    checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  };
  runtimeChecks?: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail: string;
  }>;
  message?: string;
};
