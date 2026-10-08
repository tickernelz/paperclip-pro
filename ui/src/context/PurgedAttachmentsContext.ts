import { createContext } from "react";

/** Content paths of attachments the current task lists as removed by retention, mapped to their purge time. */
export const PurgedAttachmentsContext = createContext<Map<string, string>>(new Map());
