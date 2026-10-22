import type { ReactNode } from 'react';
import type { ColDef } from 'ag-grid-community';
import { DataGrid, type Row } from './data-grid';

// The frame of a data page (the guard log): title, one line on what the rows are, an optional
// status at the right of the title, then the rows in an AG Grid.
export function EndpointPage({
  title,
  summary,
  aside,
  rows,
  columns,
  children,
}: {
  title: string;
  /** One line under the title saying what the rows are. */
  summary: string;
  /** Shown at the right of the title, e.g. a status badge. */
  aside?: ReactNode;
  rows: Row[];
  columns: ColDef<Row>[];
  /** Shown between the header and the grid. */
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-pp-canvas px-8 py-6 font-paypal text-pp-ink">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-pp-navy">{title}</h1>
          <p className="mt-1 text-sm text-pp-muted">{summary}</p>
        </div>
        {aside}
      </div>
      {children}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <DataGrid rows={rows} columns={columns} />
      </div>
    </main>
  );
}
