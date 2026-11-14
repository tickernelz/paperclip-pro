
export interface BuildSandboxCrManifestInput {
  namespace: string;
  sandboxName: string;
  adapterType: string;
  image: string;
  envSecretName: string;
  serviceAccountName: string;
  labels: Record<string, string>;
  resources: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  runtimeClassName?: string;
  imagePullSecrets?: string[];
}

export function buildSandboxCrManifest(
  input: BuildSandboxCrManifestInput,
): Record<string, unknown> {
  const podLabels: Record<string, string> = {
    ...input.labels,
    "wardmote.dev/role": "agent",
  };
  return {
    apiVersion: "agents.x-k8s.io/v1alpha1",
    kind: "Sandbox",
    metadata: {
      name: input.sandboxName,
      namespace: input.namespace,
      labels: { ...input.labels },
    },
    spec: {
      podTemplate: {
        metadata: {
          labels: podLabels,
        },
        spec: {
          serviceAccountName: input.serviceAccountName,
          automountServiceAccountToken: false,
          // Sandbox controller requires restartPolicy: Always so the pod
          // stays running between exec calls.
          restartPolicy: "Always",
          ...(input.runtimeClassName
            ? { runtimeClassName: input.runtimeClassName }
            : {}),
          ...(input.imagePullSecrets && input.imagePullSecrets.length > 0
            ? {
                imagePullSecrets: input.imagePullSecrets.map((name) => ({
                  name,
                })),
              }
            : {}),
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            fsGroupChangePolicy: "OnRootMismatch",
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "agent",
              image: input.image,
              imagePullPolicy: "IfNotPresent",
              command: [
                "/usr/bin/tini",
                "--",
                "/bin/sh",
                "-c",
                "sleep infinity",
              ],
              // HOME must point at a writable mount; the image's default
               // HOME=/home/node is inside the readOnly root filesystem.
               // Claude (and most agent runtimes) silently exit with code 0
               // and no output when HOME is unwritable, so set this explicitly.
              env: [{ name: "HOME", value: "/home/wardmote" }],
              envFrom: [{ secretRef: { name: input.envSecretName } }],
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 1000,
                runAsGroup: 1000,
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              resources: {
                requests: input.resources.requests ?? {
                  cpu: "250m",
                  memory: "512Mi",
                },
                limits: input.resources.limits ?? {
                  cpu: "2",
                  memory: "4Gi",
                },
              },
              volumeMounts: [
                { name: "workspace", mountPath: "/workspace" },
                { name: "home", mountPath: "/home/wardmote" },
                { name: "cache", mountPath: "/home/wardmote/.cache" },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: "8Gi" } },
            { name: "home", emptyDir: { sizeLimit: "1Gi" } },
            { name: "cache", emptyDir: { sizeLimit: "1Gi" } },
            { name: "tmp", emptyDir: { sizeLimit: "2Gi" } },
          ],
        },
      },
    },
  };
}
