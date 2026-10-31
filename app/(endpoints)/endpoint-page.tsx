import type { ReactNode } from 'react';
import type { ColDef } from 'ag-grid-community';
import { PageHeader } from '../ui/page-header';
import { DataGrid, type Row } from './data-grid';

// The frame of a data page (the guard log): title, one line on what the rows are, an optional
// status at the right of the title, what goes between, then the rows in an AG Grid.
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
    <main className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col px-6 py-8 font-paypal text-pp-ink md:px-10">
      <PageHeader title={title} aside={aside}>
        {summary}
      </PageHeader>
      {children}
      <div className="mt-8 flex min-h-[28rem] flex-1 flex-col">
        <DataGrid rows={rows} columns={columns} />
      </div>
    </main>
  );
}
