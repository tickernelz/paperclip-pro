import pc from "picocolors";

const WARDMOTE_ART = [
  "██╗    ██╗ █████╗ ██████╗ ██████╗ ███╗   ███╗ ██████╗ ████████╗███████╗",
  "██║    ██║██╔══██╗██╔══██╗██╔══██╗████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝",
  "██║ █╗ ██║███████║██████╔╝██║  ██║██╔████╔██║██║   ██║   ██║   █████╗  ",
  "██║███╗██║██╔══██║██╔══██╗██║  ██║██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  ",
  "╚███╔███╔╝██║  ██║██║  ██║██████╔╝██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗",
  " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝",
] as const;

const TAGLINE = "Run a company of AI agents: tasks, decisions, approvals and live runs.";

export function printWardmoteCliBanner(): void {
  const lines = [
    "",
    ...WARDMOTE_ART.map((line) => pc.cyan(line)),
    pc.blue(`  ${"─".repeat(TAGLINE.length)}`),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
