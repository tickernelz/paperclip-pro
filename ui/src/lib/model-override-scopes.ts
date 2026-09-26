import type { IssueRunModelOverrideSubtaskScope } from "@tickernelz/paperclip-pro-shared";

export const MODEL_OVERRIDE_SCOPES: {
  value: IssueRunModelOverrideSubtaskScope;
  label: string;
}[] = [
  { value: "new", label: "New subtasks" },
  { value: "new_and_existing", label: "New and existing" },
];
