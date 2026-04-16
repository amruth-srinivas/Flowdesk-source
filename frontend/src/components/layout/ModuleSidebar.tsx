type ModuleSidebarProps = {
  pageLabel: string;
  modules: string[];
  activeModule: string;
  onSelectModule: (module: string) => void;
};

export function ModuleSidebar({ pageLabel, modules, activeModule, onSelectModule }: ModuleSidebarProps) {
  return (
    <aside className="sidebar">
      <h4>{pageLabel} Modules</h4>
      {modules.map((module) => (
        <button
          key={module}
          type="button"
          className={module === activeModule ? 'active' : ''}
          onClick={() => onSelectModule(module)}
        >
          {module}
        </button>
      ))}
    </aside>
  );
}
