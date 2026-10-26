import { createContext } from "react";

/** Opens the task side panel on the agent todo tab; null when no side panel hosts it. */
export const AgentTodoPanelContext = createContext<(() => void) | null>(null);
