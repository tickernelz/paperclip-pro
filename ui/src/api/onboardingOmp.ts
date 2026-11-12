import type {
  OmpCustomProviderInput,
  OmpCustomProviderList,
  OmpCustomProviderModelsFetchInput,
  OmpCustomProviderModelsFetchResult,
  OmpCustomProviderProbeInput,
  OmpCustomProviderProbeResult,
  OnboardingOmpBrowseResult,
  OnboardingOmpLoginProviders,
  OnboardingOmpLoginView,
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
  loginProviders: (refresh = false) =>
    api.get<OnboardingOmpLoginProviders>(`/onboarding/omp/login/providers${refresh ? "?refresh=1" : ""}`),
  startLogin: (provider: string) => api.post<OnboardingOmpLoginView>("/onboarding/omp/login", { provider }),
  login: (id: string) => api.get<OnboardingOmpLoginView>(`/onboarding/omp/login/${encodeURIComponent(id)}`),
  answerLogin: (id: string, value: string) =>
    api.post<OnboardingOmpLoginView>(`/onboarding/omp/login/${encodeURIComponent(id)}/input`, { value }),
  cancelLogin: (id: string) => api.delete<OnboardingOmpLoginView>(`/onboarding/omp/login/${encodeURIComponent(id)}`),
  customProviders: () => api.get<OmpCustomProviderList>("/onboarding/omp/custom-providers"),
  saveCustomProvider: (name: string, input: OmpCustomProviderInput) =>
    api.put<OmpCustomProviderList>(`/onboarding/omp/custom-providers/${encodeURIComponent(name)}`, input),
  removeCustomProvider: (name: string) =>
    api.delete<OmpCustomProviderList>(`/onboarding/omp/custom-providers/${encodeURIComponent(name)}`),
  fetchCustomProviderModels: (input: OmpCustomProviderModelsFetchInput) =>
    api.post<OmpCustomProviderModelsFetchResult>("/onboarding/omp/custom-providers/models", input),
  probeCustomProvider: (input: OmpCustomProviderProbeInput) =>
    api.post<OmpCustomProviderProbeResult>("/onboarding/omp/custom-providers/probe", input),
  remote: (address: string) => api.post<OnboardingRemoteOmpStatus>("/onboarding/omp/remote", { address }),
};
