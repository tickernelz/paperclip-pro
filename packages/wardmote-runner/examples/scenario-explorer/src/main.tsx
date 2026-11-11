import { createRoot } from "react-dom/client";

import {
  buildCapabilityScenarioIndex,
  capabilityEvalSuiteLookup,
} from "@paperclip-runner-local/capability";

import "@tickernelz/wardmote-runner/styles.css";
import "./explorer.css";

import evalReport from "virtual:capability-eval-report";
import manifestSource from "virtual:capability-scenario-manifest";

import { ExplorerApp } from "./app.js";
import { CapabilityRemoteChatSession } from "./remote-chat-session.js";


const container = document.querySelector("#root");
if (container === null) throw new Error("explorer root element is missing");

const index = buildCapabilityScenarioIndex(manifestSource);

createRoot(container).render(
  <ExplorerApp
    index={index}
    evalSuite={evalReport === null ? undefined : capabilityEvalSuiteLookup(evalReport)}
    codexAvailable={false}
    openSession={CapabilityRemoteChatSession.available() ? CapabilityRemoteChatSession.open : undefined}
  />,
);
