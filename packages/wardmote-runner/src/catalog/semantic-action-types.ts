export type WardmoteSemanticActionId =
  | "search_api"
  | "call_api"
  | "set_task_title"
  | "set_task_monitor"
  | "get_task_context"
  | "get_task_history"
  | "list_documents"
  | "read_document"
  | "list_document_revisions"
  | "report_progress"
  | "answer_status_question"
  | "write_document"
  | "request_human_input"
  | "register_deliverable"
  | "finish_task"
  | "block_task"
  | "request_review"
  | "list_agents"
  | "hire_agent"
  | "get_agent"
  | "search_tasks"
  | "list_approvals"
  | "get_approval"
  | "get_approval_context"
  | "get_workspace_runtime"
  | "control_workspace_service"
  | "reassign_task"
  | "set_dependencies"
  | "create_skill"
  | "update_skill"
  | "create_project"
  | "list_project_repositories"
  | "list_projects"
  | "create_task"
  | "request_approval"
  | "decide_approval"
  | "comment_on_approval"
  | "schedule_wake";

export type WardmoteSemanticActionPlacement = "always" | "optional";
export type WardmoteSemanticActionMode =
  "standard" | "ask" | "planning" | "skill_test";
export type WardmoteSemanticActionEffect = "read" | "write" | "governance";

export type WardmoteJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly WardmoteJsonValue[]
  | { readonly [key: string]: WardmoteJsonValue };

/** The JSON Schema subset used by the v1 semantic action catalog. */
export interface WardmoteJsonSchema {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, WardmoteJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | WardmoteJsonSchema;
  readonly items?: WardmoteJsonSchema;
  readonly enum?: readonly WardmoteJsonValue[];
  readonly oneOf?: readonly WardmoteJsonSchema[];
  readonly anyOf?: readonly WardmoteJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: WardmoteJsonValue;
}

/**
 * A transport-neutral declaration. Catalog membership never grants discovery
 * or invocation authority; a run-scoped authorization layer must do that.
 */
export interface WardmoteSemanticActionDescriptor {
  readonly schema: "paperclip.semantic-action.v1";
  readonly operationId: WardmoteSemanticActionId;
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly placement: WardmoteSemanticActionPlacement;
  readonly effect: WardmoteSemanticActionEffect;
  readonly requiredClaims: readonly string[];
  readonly allowedModes: readonly WardmoteSemanticActionMode[];
  readonly allowedRoles?: readonly string[];
  readonly inputSchema: WardmoteJsonSchema;
  readonly outputSchema: WardmoteJsonSchema;
}
