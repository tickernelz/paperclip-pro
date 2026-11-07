import type { CostByUserReport } from "@tickernelz/paperclip-pro-shared";
import { CostAmount } from "./CostAmount";
import { Identity } from "./Identity";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { formatTokens } from "../lib/utils";

export function CostByUserTable({ report }: { report: CostByUserReport }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-0 px-5">
        <CardTitle className="text-base">By user</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="overflow-x-auto">
          <table aria-label="Costs by user" className="stack-table w-full text-sm">
            <thead className="text-ink-3">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 text-left font-medium">User</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Runs</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Input</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Output</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr><td colSpan={5} data-cell="title" className="py-3 text-ink-3">No user-attributed costs yet.</td></tr>
              )}
              {report.rows.map(row => (
                <tr key={row.userId ?? "unattributed"} className="border-b border-line last:border-0">
                  <th scope="row" data-cell="title" className="py-3 pr-4 text-left font-normal">
                    {row.userId ? <Identity name={row.userName ?? "Unknown user"} avatarUrl={row.userImage} /> : "Unattributed"}
                  </th>
                  <td data-cell="meta" data-label="Runs" className="px-4 py-3 text-right tabular-nums">{row.runCount.toLocaleString()}</td>
                  <td data-cell="meta" data-label="Input" className="px-4 py-3 text-right tabular-nums">
                    {formatTokens(row.inputTokens + row.cachedInputTokens)}
                    {row.cachedInputTokens > 0 && <div className="whitespace-nowrap text-xs text-ink-3">{formatTokens(row.cachedInputTokens)} cached</div>}
                  </td>
                  <td data-cell="meta" data-label="Output" className="px-4 py-3 text-right tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td data-cell="end" className="py-3 pl-4 text-right tabular-nums">
                    <CostAmount costCents={row.costCents} eventCount={row.eventCount} estimatedEventCount={row.estimatedEventCount} unpricedEventCount={row.unpricedEventCount} />
                    {row.unpricedEventCount > 0 && <div className="whitespace-nowrap text-xs text-ink-3">{row.unpricedEventCount} unpriced {row.unpricedEventCount === 1 ? "charge" : "charges"}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.rows.some(row => row.userId === null) && (
          <p className="mt-3 text-xs text-ink-3">Unattributed costs have no recorded user in this organization.</p>
        )}
      </CardContent>
    </Card>
  );
}
