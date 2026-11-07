import { useMemo } from "react";
import { parseCsv } from "@/lib/csv-preview";

const MAX_VISIBLE_ROWS = 500;
const MAX_VISIBLE_COLUMNS = 100;

export function CsvPreview({ text, title }: { text: string; title: string }) {
  const parsed = useMemo(() => {
    try { return { rows: parseCsv(text), error: null }; }
    catch (error) { return { rows: [], error: (error as Error).message }; }
  }, [text]);
  if (parsed.error) return <p role="alert" className="p-4 text-sm text-ink-3">{parsed.error}</p>;
  if (!parsed.rows.length) return <p className="p-4 text-sm text-ink-3">File is empty.</p>;
  const [header, ...rows] = parsed.rows;
  const columnCount = parsed.rows.reduce((count, row) => Math.max(count, row.length), 0);
  const columns = Array.from({ length: Math.min(columnCount, MAX_VISIBLE_COLUMNS) }, (_, index) => index);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs text-ink-3" role="status">
        <span className="font-medium text-ink">CSV preview</span>
        <span>{rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}</span>
        <span>{columnCount.toLocaleString()} {columnCount === 1 ? "column" : "columns"}</span>
        {(rows.length > MAX_VISIBLE_ROWS || columnCount > MAX_VISIBLE_COLUMNS) && <span>Showing the first {Math.min(rows.length, MAX_VISIBLE_ROWS)} rows and {columns.length} columns. Download for the complete file.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset" role="region" aria-label={`${title} CSV table`} tabIndex={0}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{title} — first record used as column headers</caption>
          <thead className="sticky top-0 z-10 bg-bg-3">
            <tr><th scope="col" className="w-10 border-b border-line px-3 py-3 text-right font-mono text-xs text-ink-3"><span className="sr-only">Row</span>#</th>
              {columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap border-b border-line px-4 py-3 text-left font-medium">{header[column] || `Column ${column + 1}`}</th>)}
            </tr>
          </thead>
          <tbody>{rows.slice(0, MAX_VISIBLE_ROWS).map((row, index) => <tr key={index} className="even:bg-bg-3/30 hover:bg-bg-3/50">
            <th scope="row" className="border-b border-line/50 px-3 py-2 text-right font-mono text-xs font-normal text-ink-3">{index + 1}</th>
            {columns.map((column) => <td key={column} className="whitespace-pre-wrap border-b border-line/50 px-4 py-2 align-top">{row[column] ?? ""}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
