export const WARDMOTE_QUESTION_SET_SCHEMA = "paperclip.question_set.v1" as const;
export const WARDMOTE_QUESTION_RESPONSE_SCHEMA = "paperclip.question_response.v1" as const;
export const WARDMOTE_RUNTIME_REQUEST_SCHEMA_V2 = "paperclip.runtime_request.v2" as const;

export type WardmoteQuestionAnswerMode = "single_select" | "multi_select" | "text";

export interface WardmoteQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface WardmoteQuestionCustomAnswer {
  enabled: true;
  label?: string;
  placeholder?: string;
}

export interface WardmoteQuestionTextValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  inputType?: "text" | "number" | "integer";
  minimum?: number;
  maximum?: number;
}

export interface WardmoteQuestion {
  id: string;
  header?: string;
  prompt: string;
  helpText?: string;
  required: boolean;
  answerMode: WardmoteQuestionAnswerMode;
  /** Editable starting text, never an implicit or submitted answer. Text mode only. */
  initialText?: string;
  options?: WardmoteQuestionOption[];
  customAnswer?: WardmoteQuestionCustomAnswer;
  textValidation?: WardmoteQuestionTextValidation;
}

export interface WardmoteQuestionSet {
  schema: typeof WARDMOTE_QUESTION_SET_SCHEMA;
  title?: string;
  description?: string;
  submitLabel?: string;
  questions: WardmoteQuestion[];
}

export interface WardmoteQuestionAnswer {
  selectedOptionIds?: string[];
  text?: string;
  customText?: string;
}

export interface WardmoteQuestionResponse {
  schema: typeof WARDMOTE_QUESTION_RESPONSE_SCHEMA;
  answers: Record<string, WardmoteQuestionAnswer>;
}

export interface WardmoteRuntimeRequestOrigin {
  adapter: string;
  provider?: string;
  method?: string;
}

export interface WardmoteRuntimeInputRequest {
  schema: typeof WARDMOTE_RUNTIME_REQUEST_SCHEMA_V2;
  requestKind: "runtime";
  requestId: string;
  type: "input";
  status: "pending" | "resolved" | "expired" | "cancelled";
  prompt: string;
  input: WardmoteQuestionSet;
  origin?: WardmoteRuntimeRequestOrigin;
  turnId?: string;
  itemId?: string;
}

export class WardmoteQuestionValidationError extends Error {
  readonly code = "invalid_question_response" as const;
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "WardmoteQuestionValidationError";
    this.path = path;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) {
    throw new WardmoteQuestionValidationError(`${path}/${unknown}`, "is not part of the canonical response contract");
  }
}

function requiredText(value: unknown, path: string, maxLength = 4_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new WardmoteQuestionValidationError(path, `must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function optionalText(value: unknown, path: string, maxLength = 4_000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new WardmoteQuestionValidationError(path, `must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WardmoteQuestionValidationError(path, "must be a finite number");
  }
  return value;
}

/** Parse and sanitize the provider-neutral presentation contract at an adapter boundary. */
export function parseWardmoteQuestionSet(value: unknown): WardmoteQuestionSet {
  const candidate = record(value);
  if (candidate === null || candidate.schema !== WARDMOTE_QUESTION_SET_SCHEMA) {
    throw new WardmoteQuestionValidationError("/input", `must use ${WARDMOTE_QUESTION_SET_SCHEMA}`);
  }
  if (!Array.isArray(candidate.questions) || candidate.questions.length === 0 || candidate.questions.length > 64) {
    throw new WardmoteQuestionValidationError("/input/questions", "must contain between 1 and 64 questions");
  }
  const questionIds = new Set<string>();
  const questions = candidate.questions.map((rawQuestion, questionIndex): WardmoteQuestion => {
    const path = `/input/questions/${questionIndex}`;
    const question = record(rawQuestion);
    if (question === null) throw new WardmoteQuestionValidationError(path, "must be an object");
    const id = requiredText(question.id, `${path}/id`, 160);
    if (questionIds.has(id)) throw new WardmoteQuestionValidationError(`${path}/id`, "must be unique");
    questionIds.add(id);
    const answerMode = question.answerMode;
    if (answerMode !== "single_select" && answerMode !== "multi_select" && answerMode !== "text") {
      throw new WardmoteQuestionValidationError(`${path}/answerMode`, "must be single_select, multi_select, or text");
    }
    if (typeof question.required !== "boolean") {
      throw new WardmoteQuestionValidationError(`${path}/required`, "must be boolean");
    }
    if (Array.isArray(question.options) && question.options.length > 128) {
      throw new WardmoteQuestionValidationError(`${path}/options`, "cannot contain more than 128 options");
    }
    const options: WardmoteQuestionOption[] | undefined = Array.isArray(question.options)
      ? question.options.map((rawOption, optionIndex) => {
          const optionPath = `${path}/options/${optionIndex}`;
          const option = record(rawOption);
          if (option === null) throw new WardmoteQuestionValidationError(optionPath, "must be an object");
          if (option.recommended !== undefined && typeof option.recommended !== "boolean") {
            throw new WardmoteQuestionValidationError(`${optionPath}/recommended`, "must be boolean");
          }
          return {
            id: requiredText(option.id, `${optionPath}/id`, 160),
            label: requiredText(option.label, `${optionPath}/label`, 1_000),
            ...(optionalText(option.description, `${optionPath}/description`) !== undefined
              ? { description: optionalText(option.description, `${optionPath}/description`) }
              : {}),
            ...(option.recommended !== undefined ? { recommended: option.recommended } : {}),
          };
        })
      : undefined;
    if (options !== undefined && new Set(options.map((option) => option.id)).size !== options.length) {
      throw new WardmoteQuestionValidationError(`${path}/options`, "option IDs must be unique within a question");
    }
    if (answerMode !== "text" && (!options || options.length === 0)) {
      throw new WardmoteQuestionValidationError(`${path}/options`, "select questions require at least one option");
    }
    if (answerMode === "text" && options !== undefined && options.length > 0) {
      throw new WardmoteQuestionValidationError(`${path}/options`, "text questions cannot define options");
    }
    const initialText = question.initialText;
    if (initialText !== undefined && (
      typeof initialText !== "string"
      || initialText.length > 200_000
      || Array.from(initialText).length > 100_000
    )) {
      throw new WardmoteQuestionValidationError(`${path}/initialText`, "must be a string of at most 100000 Unicode code points");
    }
    if (initialText !== undefined && answerMode !== "text") {
      throw new WardmoteQuestionValidationError(`${path}/initialText`, "only text questions can define initial text");
    }
    const custom = record(question.customAnswer);
    const customAnswer = custom === null
      ? undefined
      : {
          enabled: true as const,
          ...(optionalText(custom.label, `${path}/customAnswer/label`, 1_000) !== undefined
            ? { label: optionalText(custom.label, `${path}/customAnswer/label`, 1_000) }
            : {}),
          ...(optionalText(custom.placeholder, `${path}/customAnswer/placeholder`, 1_000) !== undefined
            ? { placeholder: optionalText(custom.placeholder, `${path}/customAnswer/placeholder`, 1_000) }
            : {}),
        };
    if (custom !== null && custom.enabled !== true) {
      throw new WardmoteQuestionValidationError(`${path}/customAnswer/enabled`, "must be true when customAnswer is present");
    }
    if (answerMode === "text" && customAnswer !== undefined) {
      throw new WardmoteQuestionValidationError(`${path}/customAnswer`, "text questions do not use a separate custom answer");
    }
    const validation = record(question.textValidation);
    const textValidation: WardmoteQuestionTextValidation | undefined = validation === null
      ? undefined
      : {
          ...(typeof validation.minLength === "number" ? { minLength: validation.minLength } : {}),
          ...(typeof validation.maxLength === "number" ? { maxLength: validation.maxLength } : {}),
          ...(optionalText(validation.pattern, `${path}/textValidation/pattern`, 1_000) !== undefined
            ? { pattern: optionalText(validation.pattern, `${path}/textValidation/pattern`, 1_000) }
            : {}),
          ...(validation.inputType === "number" || validation.inputType === "integer" || validation.inputType === "text"
            ? { inputType: validation.inputType }
            : {}),
          ...(optionalFiniteNumber(validation.minimum, `${path}/textValidation/minimum`) !== undefined
            ? { minimum: optionalFiniteNumber(validation.minimum, `${path}/textValidation/minimum`) }
            : {}),
          ...(optionalFiniteNumber(validation.maximum, `${path}/textValidation/maximum`) !== undefined
            ? { maximum: optionalFiniteNumber(validation.maximum, `${path}/textValidation/maximum`) }
            : {}),
        };
    if (validation !== null) {
      for (const key of ["minLength", "maxLength"] as const) {
        const raw = validation[key];
        if (raw !== undefined && (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > 100_000)) {
          throw new WardmoteQuestionValidationError(`${path}/textValidation/${key}`, "must be an integer from 0 through 100000");
        }
      }
      if (validation.inputType !== undefined && !["text", "number", "integer"].includes(String(validation.inputType))) {
        throw new WardmoteQuestionValidationError(`${path}/textValidation/inputType`, "must be text, number, or integer");
      }
      if (textValidation?.minLength !== undefined && textValidation.maxLength !== undefined && textValidation.minLength > textValidation.maxLength) {
        throw new WardmoteQuestionValidationError(`${path}/textValidation`, "minLength cannot exceed maxLength");
      }
      if (textValidation?.minimum !== undefined && textValidation.maximum !== undefined && textValidation.minimum > textValidation.maximum) {
        throw new WardmoteQuestionValidationError(`${path}/textValidation`, "minimum cannot exceed maximum");
      }
      if (textValidation?.pattern !== undefined) {
        try { new RegExp(textValidation.pattern); } catch {
          throw new WardmoteQuestionValidationError(`${path}/textValidation/pattern`, "must be a valid regular expression");
        }
      }
    }
    return {
      id,
      ...(optionalText(question.header, `${path}/header`, 1_000) !== undefined
        ? { header: optionalText(question.header, `${path}/header`, 1_000) }
        : {}),
      prompt: requiredText(question.prompt, `${path}/prompt`),
      ...(optionalText(question.helpText, `${path}/helpText`) !== undefined
        ? { helpText: optionalText(question.helpText, `${path}/helpText`) }
        : {}),
      required: question.required,
      answerMode,
      ...(initialText !== undefined ? { initialText } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(customAnswer !== undefined ? { customAnswer } : {}),
      ...(textValidation !== undefined ? { textValidation } : {}),
    };
  });
  return {
    schema: WARDMOTE_QUESTION_SET_SCHEMA,
    ...(optionalText(candidate.title, "/input/title", 1_000) !== undefined
      ? { title: optionalText(candidate.title, "/input/title", 1_000) }
      : {}),
    ...(optionalText(candidate.description, "/input/description", 100_000) !== undefined
      ? { description: optionalText(candidate.description, "/input/description", 100_000) }
      : {}),
    ...(optionalText(candidate.submitLabel, "/input/submitLabel", 200) !== undefined
      ? { submitLabel: optionalText(candidate.submitLabel, "/input/submitLabel", 200) }
      : {}),
    questions,
  };
}

function answerHasValue(answer: WardmoteQuestionAnswer): boolean {
  return Boolean(answer.text?.trim() || answer.customText?.trim() || answer.selectedOptionIds?.length);
}

/** Revalidate untrusted UI input against the persisted question set. */
export function parseWardmoteQuestionResponse(
  questionSetValue: unknown,
  responseValue: unknown,
): WardmoteQuestionResponse {
  const questionSet = parseWardmoteQuestionSet(questionSetValue);
  const response = record(responseValue);
  if (response === null || response.schema !== WARDMOTE_QUESTION_RESPONSE_SCHEMA) {
    throw new WardmoteQuestionValidationError("/response", `must use ${WARDMOTE_QUESTION_RESPONSE_SCHEMA}`);
  }
  rejectUnknownKeys(response, ["schema", "answers"], "/response");
  const rawAnswers = record(response.answers);
  if (rawAnswers === null) throw new WardmoteQuestionValidationError("/response/answers", "must be an object keyed by question ID");
  const questions = new Map(questionSet.questions.map((question) => [question.id, question]));
  for (const questionId of Object.keys(rawAnswers)) {
    if (!questions.has(questionId)) throw new WardmoteQuestionValidationError(`/response/answers/${questionId}`, "does not match a question in the persisted set");
  }
  const answers: Record<string, WardmoteQuestionAnswer> = {};
  for (const question of questionSet.questions) {
    const path = `/response/answers/${question.id}`;
    const raw = rawAnswers[question.id];
    if (raw === undefined) {
      if (question.required) throw new WardmoteQuestionValidationError(path, "is required");
      continue;
    }
    const answer = record(raw);
    if (answer === null) throw new WardmoteQuestionValidationError(path, "must be an object");
    rejectUnknownKeys(answer, ["selectedOptionIds", "text", "customText"], path);
    const selectedOptionIds = answer.selectedOptionIds === undefined
      ? undefined
      : Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.every((entry) => typeof entry === "string")
        ? [...answer.selectedOptionIds]
        : null;
    if (selectedOptionIds === null) throw new WardmoteQuestionValidationError(`${path}/selectedOptionIds`, "must be an array of strings");
    if (selectedOptionIds !== undefined && new Set(selectedOptionIds).size !== selectedOptionIds.length) {
      throw new WardmoteQuestionValidationError(`${path}/selectedOptionIds`, "cannot contain duplicates");
    }
    const textValue = optionalText(answer.text, `${path}/text`, 100_000);
    const customText = optionalText(answer.customText, `${path}/customText`, 100_000);
    if (question.answerMode === "text") {
      if (selectedOptionIds?.length || customText !== undefined) throw new WardmoteQuestionValidationError(path, "text answers only carry text");
    } else {
      if (textValue !== undefined) throw new WardmoteQuestionValidationError(path, "select answers do not carry text");
      const allowed = new Set((question.options ?? []).map((option) => option.id));
      for (const optionId of selectedOptionIds ?? []) {
        if (!allowed.has(optionId)) throw new WardmoteQuestionValidationError(`${path}/selectedOptionIds`, `contains unknown option ${optionId}`);
      }
      if (question.answerMode === "single_select" && (selectedOptionIds?.length ?? 0) > 1) {
        throw new WardmoteQuestionValidationError(`${path}/selectedOptionIds`, "single-select answers choose at most one option");
      }
      if (customText !== undefined && question.customAnswer?.enabled !== true) {
        throw new WardmoteQuestionValidationError(`${path}/customText`, "custom answers are not enabled for this question");
      }
      if (customText?.trim() && (selectedOptionIds?.length ?? 0) > 0 && question.answerMode === "single_select") {
        throw new WardmoteQuestionValidationError(path, "single-select answers cannot select an option and a custom answer");
      }
    }
    const parsed: WardmoteQuestionAnswer = {
      ...(selectedOptionIds !== undefined ? { selectedOptionIds } : {}),
      ...(textValue !== undefined ? { text: textValue } : {}),
      ...(customText !== undefined ? { customText } : {}),
    };
    if (question.required && !answerHasValue(parsed)) throw new WardmoteQuestionValidationError(path, "is required");
    const boundedText = question.answerMode === "text" ? parsed.text : parsed.customText;
    if (boundedText !== undefined) {
      const validation = question.textValidation;
      if (validation?.minLength !== undefined && boundedText.length < validation.minLength) {
        throw new WardmoteQuestionValidationError(path, `must contain at least ${validation.minLength} characters`);
      }
      if (validation?.maxLength !== undefined && boundedText.length > validation.maxLength) {
        throw new WardmoteQuestionValidationError(path, `must contain at most ${validation.maxLength} characters`);
      }
      if (validation?.pattern !== undefined && !new RegExp(validation.pattern).test(boundedText)) {
        throw new WardmoteQuestionValidationError(path, "does not match the required format");
      }
      if (validation?.inputType === "number" || validation?.inputType === "integer") {
        const numeric = Number(boundedText);
        if (!Number.isFinite(numeric) || (validation.inputType === "integer" && !Number.isInteger(numeric))) {
          throw new WardmoteQuestionValidationError(path, `must be a valid ${validation.inputType}`);
        }
        if (validation.minimum !== undefined && numeric < validation.minimum) throw new WardmoteQuestionValidationError(path, `must be at least ${validation.minimum}`);
        if (validation.maximum !== undefined && numeric > validation.maximum) throw new WardmoteQuestionValidationError(path, `must be at most ${validation.maximum}`);
      }
    }
    if (answerHasValue(parsed)) answers[question.id] = parsed;
  }
  return { schema: WARDMOTE_QUESTION_RESPONSE_SCHEMA, answers };
}
