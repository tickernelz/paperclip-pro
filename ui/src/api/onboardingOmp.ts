import type {
  OnboardingOmpBrowseResult,
  OnboardingOmpLoginProvider,
  OnboardingOmpLoginResult,
  OnboardingOmpStatus,
  OnboardingRemoteOmpStatus,
} from "@tickernelz/wardmote-shared";
import { api } from "./client";

export const onboardingOmpApi = {
  status: (options: { command?: string | null; network?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.command) params.set("command", options.command);
    if (options.network) params.set("network", "1");
    const query = params.toString();
    return api.get<OnboardingOmpStatus>(`/onboarding/omp${query ? `?${query}` : ""}`);
  },
  browse: (path?: string | null) =>
    api.get<OnboardingOmpBrowseResult>(`/onboarding/omp/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  login: (provider: OnboardingOmpLoginProvider) =>
    api.post<OnboardingOmpLoginResult>("/onboarding/omp/login", { provider }),
  remote: (address: string) => api.post<OnboardingRemoteOmpStatus>("/onboarding/omp/remote", { address }),
};
