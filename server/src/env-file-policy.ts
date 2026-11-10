export function shouldLoadWorkingDirectoryEnv(input: {
  cwdEnvExists: boolean;
  isWardmoteEnvFile: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  return env.WARDMOTE_DISABLE_CWD_ENV_FILE !== "true"
    && input.cwdEnvExists
    && !input.isWardmoteEnvFile;
}
