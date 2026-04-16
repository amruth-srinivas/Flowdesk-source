import { motion } from 'framer-motion';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Tag } from 'primereact/tag';
import type { CalendarEventRecord } from '../../lib/api';

function humanizeType(value: string): string {
  return value.replace(/_/g, ' ');
}

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function statusSeverity(s: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'on_hold':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type CalendarEventsTableProps = {
  viewKey: string;
  rows: CalendarEventRecord[];
  isLoading: boolean;
};

export function CalendarEventsTable({ viewKey, rows, isLoading }: CalendarEventsTableProps) {
  return (
    <motion.article
      key={viewKey}
      className="page-card user-management-page calendar-events-table-page"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="user-table-shell">
        <div className="user-table-toolbar">
          <div>
            <h2 style={{ margin: 0, fontSize: '15px' }}>All activities</h2>
            <p style={{ margin: '4px 0 0', color: '#62749a', fontSize: '12px' }}>
              Tabular list of project events. Use <strong>Calendar</strong> in the sidebar to see the month grid, activity
              chips, and full details in the side panel.
            </p>
          </div>
        </div>

        <DataTable
          value={rows}
          loading={isLoading}
          paginator
          rows={12}
          rowsPerPageOptions={[12, 24, 48]}
          sortField="start_at"
          sortOrder={-1}
          removableSort
          className="user-table"
          emptyMessage="No activities yet. Admins can add them from the Calendar module."
          dataKey="id"
        >
          <Column
            field="title"
            header="Title"
            sortable
            style={{ minWidth: '160px' }}
            body={(row: CalendarEventRecord) => <strong style={{ color: '#233a65' }}>{row.title}</strong>}
          />
          <Column
            field="project_name"
            header="Project"
            sortable
            body={(row: CalendarEventRecord) => row.project_name ?? '—'}
          />
          <Column
            field="event_type"
            header="Type"
            sortable
            body={(row: CalendarEventRecord) => (
              <Tag value={humanizeType(row.event_type)} severity="info" rounded />
            )}
          />
          <Column
            field="status"
            header="Status"
            sortable
            body={(row: CalendarEventRecord) => (
              <Tag value={humanizeStatus(row.status)} severity={statusSeverity(row.status)} rounded />
            )}
          />
          <Column
            field="start_at"
            header="Start"
            sortable
            body={(row: CalendarEventRecord) => formatDateTime(row.start_at)}
          />
          <Column
            field="end_at"
            header="End"
            sortable
            body={(row: CalendarEventRecord) => (row.end_at ? formatDateTime(row.end_at) : '—')}
          />
          <Column
            field="progress_percent"
            header="Progress"
            sortable
            body={(row: CalendarEventRecord) =>
              row.progress_percent !== null && row.progress_percent !== undefined ? `${row.progress_percent}%` : '—'
            }
          />
          <Column
            header="Milestones"
            align="center"
            alignHeader="center"
            body={(row: CalendarEventRecord) => row.milestones.length}
          />
        </DataTable>
      </div>
    </motion.article>
  );
}
