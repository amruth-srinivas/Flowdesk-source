type ModuleSidebarProps = {
  pageLabel: string;
  modules: string[];
  activeModule: string;
  onSelectModule: (module: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

const moduleIconMap: Record<string, string> = {
  View: 'https://img.icons8.com/fluency-systems-regular/24/folder-invoices.png',
  'User Management': 'https://img.icons8.com/fluency-systems-regular/24/conference-call.png',
  Configuration: 'https://img.icons8.com/fluency-systems-regular/24/settings.png',
  Articles: 'https://img.icons8.com/fluency-systems-regular/24/document.png',
  Customers: 'https://img.icons8.com/fluency-systems-regular/24/groups.png',
  Calendar: 'https://img.icons8.com/fluency-systems-regular/24/planner.png',
  'Create Ticket': 'https://img.icons8.com/fluency-systems-regular/24/ticket.png',
  Tickets: 'https://img.icons8.com/fluency-systems-regular/24/ticket.png',
  'My Tickets': 'https://img.icons8.com/fluency-systems-regular/24/ticket.png',
  History: 'https://img.icons8.com/fluency-systems-regular/24/activity-history.png',
  Documents: 'https://img.icons8.com/fluency-systems-regular/24/documents.png',
  Monitoring: 'https://img.icons8.com/fluency-systems-regular/24/monitor.png',
  'Personal Tasks': 'https://img.icons8.com/fluency-systems-regular/24/task.png',
};

export function ModuleSidebar({
  pageLabel,
  modules,
  activeModule,
  onSelectModule,
  isCollapsed,
  onToggleCollapse,
}: ModuleSidebarProps) {
  return (
    <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-header">
        <h4>{pageLabel} Modules</h4>
      </div>
      <div className="sidebar-modules">
        {modules.map((module) => (
          <button
            key={module}
            type="button"
            className={`sidebar-module-button ${module === activeModule ? 'active' : ''}`}
            onClick={() => onSelectModule(module)}
            title={module}
          >
            <span className="sidebar-module-icon">
              <img src={moduleIconMap[module] ?? 'https://img.icons8.com/fluency-systems-regular/24/document.png'} alt="" />
            </span>
            <span className="sidebar-module-label">{module}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? '>>' : '<<'}
      </button>
    </aside>
  );
}
