import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';

type TopNavItem = {
  id: string;
  label: string;
  icon: ReactNode;
};

type TopHeaderProps = {
  topNav: TopNavItem[];
  selectedPageId: string;
  onSelectPage: (pageId: string) => void;
  currentUserAvatar: string;
  currentUserName: string;
  currentUserRoleLabel: string;
  currentUserIdentifier: string;
  onLogout: () => void;
};

export function TopHeader({
  topNav,
  selectedPageId,
  onSelectPage,
  currentUserAvatar,
  currentUserName,
  currentUserRoleLabel,
  currentUserIdentifier,
  onLogout,
}: TopHeaderProps) {
  return (
    <header className="top-header">
      <nav className="top-nav">
        {topNav.map((page) => (
          <button
            key={page.id}
            className={page.id === selectedPageId ? 'active' : ''}
            onClick={() => onSelectPage(page.id)}
            type="button"
          >
            {page.icon}
            {page.label}
          </button>
        ))}
      </nav>
      <div className="header-brand">
        <img
          className="sidebar-logo"
          src="/logos/logo.png"
          alt=""
          width={40}
          height={40}
          decoding="async"
        />
        <span className="sidebar-brand-text">FLOWDESK</span>
      </div>
      <div className="header-actions">
        <div className="user-chip">
          <span className="user-avatar">{currentUserAvatar}</span>
          <div className="user-meta">
            <strong>{currentUserName}</strong>
            <span className="user-submeta">
              <small>{currentUserRoleLabel}</small>
              <small>{currentUserIdentifier}</small>
            </span>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout} type="button">
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </header>
  );
}
