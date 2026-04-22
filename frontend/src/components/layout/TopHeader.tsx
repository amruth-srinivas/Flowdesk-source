import { Bell, LogOut, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from 'primereact/button';
import { Chart } from 'primereact/chart';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CalendarEventRecord, ThemePreference, TicketRecord } from '../../lib/api';

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
  currentUserAvatarUrl?: string | null;
  currentUserName: string;
  currentUserRoleLabel: string;
  currentUserIdentifier: string;
  currentUserId?: string;
  currentUserEmail?: string;
  currentUserCreatedAt?: string;
  tickets?: TicketRecord[];
  events?: CalendarEventRecord[];
  notifications: Array<{
    notification_id: string;
    request_id: string | null;
    ticket_reference: string | null;
    ticket_title: string;
    requested_by_name: string | null;
    requested_at: string;
    is_read: boolean;
  }>;
  notificationBusyId?: string | null; // request_id for acknowledge
  notificationReadBusyId?: string | null; // notification_id for mark read
  notificationDeleteBusyId?: string | null; // notification_id for delete
  onAcknowledgeNotification?: (requestId: string) => void;
  onMarkNotificationRead?: (notificationId: string) => void;
  onDeleteNotification?: (notificationId: string) => void;
  onUpdateProfile?: (payload: { name: string; email: string; avatar_url?: string | null }) => Promise<void>;
  currentThemePreference?: ThemePreference;
  onUpdateThemePreference?: (theme: ThemePreference) => Promise<void>;
  onUpdatePassword?: (newPassword: string) => Promise<void>;
  onLogout: () => void;
};

export function TopHeader({
  topNav,
  selectedPageId,
  onSelectPage,
  currentUserAvatar,
  currentUserAvatarUrl,
  currentUserName,
  currentUserRoleLabel,
  currentUserIdentifier,
  currentUserId,
  currentUserEmail,
  currentUserCreatedAt,
  tickets = [],
  events = [],
  notifications,
  notificationBusyId,
  notificationReadBusyId,
  notificationDeleteBusyId,
  onAcknowledgeNotification,
  onMarkNotificationRead,
  onDeleteNotification,
  onUpdateProfile,
  currentThemePreference,
  onUpdateThemePreference,
  onUpdatePassword,
  onLogout,
}: TopHeaderProps) {
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [profileName, setProfileName] = useState(currentUserName);
  const [profileEmail, setProfileEmail] = useState(currentUserEmail ?? '');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(currentUserAvatarUrl ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activeSettingsTab, setActiveSettingsTab] = useState<'details' | 'preferences' | 'summary'>('details');
  const [prefEmailNotifs, setPrefEmailNotifs] = useState(true);
  const [prefCompactView, setPrefCompactView] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<ThemePreference>(currentThemePreference ?? 'light');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [summaryRange, setSummaryRange] = useState<'7d' | '30d' | '90d' | '365d' | 'all'>('30d');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(currentUserAvatarUrl ?? '');
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [hasUploadedAvatar, setHasUploadedAvatar] = useState(false);

  useEffect(() => {
    setProfileName(currentUserName);
    setProfileEmail(currentUserEmail ?? '');
    setProfileAvatarUrl(currentUserAvatarUrl ?? '');
    setAvatarPreviewUrl(currentUserAvatarUrl ?? '');
    setAvatarZoom(1);
    setHasUploadedAvatar(false);
    setSelectedTheme(currentThemePreference ?? 'light');
  }, [currentUserName, currentUserEmail, currentUserAvatarUrl, currentThemePreference]);

  useEffect(() => {
    setSelectedTheme(currentThemePreference ?? 'light');
  }, [currentThemePreference]);

  async function handleSaveProfile() {
    if (!onUpdateProfile) return;
    setSettingsBusy(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      await onUpdateProfile({
        name: profileName.trim(),
        email: profileEmail.trim(),
        avatar_url: profileAvatarUrl.trim() || null,
      });
      setSettingsSuccess('Profile updated.');
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Could not update profile');
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSavePassword() {
    if (!onUpdatePassword) return;
    if (!newPassword.trim() || newPassword.trim().length < 6) {
      setSettingsError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsError('Passwords do not match.');
      return;
    }
    setSettingsBusy(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      await onUpdatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setSettingsSuccess('Password updated.');
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Could not update password');
    } finally {
      setSettingsBusy(false);
    }
  }

  function handleAvatarFileChange(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) {
        setProfileAvatarUrl(result);
        setAvatarPreviewUrl(result);
        setAvatarZoom(1);
        setHasUploadedAvatar(true);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleResetAvatarPreview() {
    const originalAvatar = currentUserAvatarUrl ?? '';
    setProfileAvatarUrl(originalAvatar);
    setAvatarPreviewUrl(originalAvatar);
    setAvatarZoom(1);
    setHasUploadedAvatar(false);
  }

  async function handleSavePreferences() {
    if (!onUpdateThemePreference) return;
    setSettingsBusy(true);
    setSettingsError('');
    setSettingsSuccess('');
    try {
      await onUpdateThemePreference(selectedTheme);
      setSettingsSuccess('Preferences updated.');
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Could not update preferences');
    } finally {
      setSettingsBusy(false);
    }
  }

  const summaryStart = useMemo(() => {
    if (summaryRange === 'all') return null;
    const now = new Date();
    const days = summaryRange === '7d' ? 7 : summaryRange === '30d' ? 30 : summaryRange === '90d' ? 90 : 365;
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    return start;
  }, [summaryRange]);

  const summary = useMemo(() => {
    const inRange = (iso?: string | null) => {
      if (!iso) return false;
      if (!summaryStart) return true;
      const dt = new Date(iso);
      return !Number.isNaN(dt.getTime()) && dt >= summaryStart;
    };
    const mine = tickets.filter((t) => currentUserId && t.assignee_ids.includes(currentUserId));
    const assignedInRange = mine.filter((t) => inRange(t.created_at));
    const closedInRange = mine.filter((t) => t.closed_at && inRange(t.closed_at));
    const activeAssigned = mine.filter((t) => t.status !== 'closed').length;
    const closedForAvg = closedInRange
      .map((t) => {
        const start = new Date(t.created_at).getTime();
        const end = t.closed_at ? new Date(t.closed_at).getTime() : NaN;
        if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
        return (end - start) / (1000 * 60 * 60 * 24);
      })
      .filter((v): v is number => v !== null);
    const avgCloseDays = closedForAvg.length ? closedForAvg.reduce((a, b) => a + b, 0) / closedForAvg.length : null;
    const efficiency = assignedInRange.length ? Math.round((closedInRange.length / assignedInRange.length) * 100) : 0;
    const eventsAttended = events.filter((evt) => evt.created_by === currentUserId && inRange(evt.start_at)).length;
    return {
      assignedCount: assignedInRange.length,
      closedCount: closedInRange.length,
      activeAssigned,
      efficiency,
      avgCloseDays,
      eventsAttended,
    };
  }, [tickets, currentUserId, summaryStart, events]);

  const chartPalette = useMemo(() => {
    if (currentThemePreference === 'midnight') {
      return {
        text: '#dde8ff',
        muted: '#8a9ec8',
        grid: '#2c3d74',
        series: ['#60a5fa', '#34d399', '#fbbf24', '#f472b6'],
      };
    }
    if (currentThemePreference === 'dark') {
      return {
        text: '#e4ebfb',
        muted: '#9cb0d8',
        grid: '#34425f',
        series: ['#7c9ee6', '#7fc7b2', '#f2b880', '#d39ac2'],
      };
    }
    return {
      text: '#2d3a5a',
      muted: '#6b7a99',
      grid: '#e6edf8',
      series: ['#7c9ee6', '#7fc7b2', '#f2b880', '#d39ac2'],
    };
  }, [currentThemePreference]);

  const ticketsInRange = useMemo(() => {
    const inRange = (iso?: string | null) => {
      if (!iso) return false;
      if (!summaryStart) return true;
      const dt = new Date(iso);
      return !Number.isNaN(dt.getTime()) && dt >= summaryStart;
    };
    return tickets.filter((t) => currentUserId && t.assignee_ids.includes(currentUserId) && inRange(t.created_at));
  }, [tickets, currentUserId, summaryStart]);

  const ticketStatusChartData = useMemo(() => {
    const closed = ticketsInRange.filter((t) => t.status === 'closed').length;
    const inProgress = ticketsInRange.filter((t) => t.status === 'in_progress' || t.status === 'in_review').length;
    const open = ticketsInRange.filter((t) => t.status === 'open').length;
    const resolved = ticketsInRange.filter((t) => t.status === 'resolved').length;
    return {
      labels: ['Open', 'In Progress/Review', 'Resolved', 'Closed'],
      datasets: [
        {
          data: [open, inProgress, resolved, closed],
          backgroundColor: chartPalette.series,
          borderWidth: 0,
        },
      ],
    };
  }, [ticketsInRange, chartPalette.series]);

  const ticketStatusChartOptions = useMemo(
    () => ({
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom' as const,
          labels: {
            color: chartPalette.muted,
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
          },
        },
      },
      cutout: '60%',
    }),
    [chartPalette.muted],
  );

  const ticketTrendChartData = useMemo(() => {
    const intervals = summaryRange === '7d' ? 7 : summaryRange === '30d' ? 6 : summaryRange === '90d' ? 6 : summaryRange === '365d' ? 12 : 8;
    const now = new Date();
    const labels: string[] = [];
    const createdCounts = new Array(intervals).fill(0);
    const closedCounts = new Array(intervals).fill(0);
    const totalDays = summaryRange === '7d' ? 7 : summaryRange === '30d' ? 30 : summaryRange === '90d' ? 90 : summaryRange === '365d' ? 365 : 240;
    const bucketSizeMs = (totalDays / intervals) * 24 * 60 * 60 * 1000;
    const startMs = now.getTime() - totalDays * 24 * 60 * 60 * 1000;

    for (let i = 0; i < intervals; i += 1) {
      const labelDate = new Date(startMs + i * bucketSizeMs);
      labels.push(labelDate.toLocaleDateString(undefined, { month: 'short', day: totalDays <= 90 ? 'numeric' : undefined }));
    }

    for (const t of ticketsInRange) {
      const created = new Date(t.created_at).getTime();
      const createdIdx = Math.min(intervals - 1, Math.max(0, Math.floor((created - startMs) / bucketSizeMs)));
      if (!Number.isNaN(created)) {
        createdCounts[createdIdx] += 1;
      }
      if (t.closed_at) {
        const closed = new Date(t.closed_at).getTime();
        const closedIdx = Math.min(intervals - 1, Math.max(0, Math.floor((closed - startMs) / bucketSizeMs)));
        if (!Number.isNaN(closed)) {
          closedCounts[closedIdx] += 1;
        }
      }
    }

    return {
      labels,
      datasets: [
        {
          label: 'Assigned',
          data: createdCounts,
          borderColor: chartPalette.series[0],
          backgroundColor: 'transparent',
          tension: 0.35,
        },
        {
          label: 'Closed',
          data: closedCounts,
          borderColor: chartPalette.series[1],
          backgroundColor: 'transparent',
          tension: 0.35,
        },
      ],
    };
  }, [ticketsInRange, summaryRange, chartPalette.series]);

  const ticketTrendChartOptions = useMemo(
    () => ({
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: chartPalette.muted },
        },
      },
      scales: {
        x: {
          ticks: { color: chartPalette.muted },
          grid: { color: chartPalette.grid },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: chartPalette.muted, precision: 0, stepSize: 1 },
          grid: { color: chartPalette.grid },
          border: { display: false },
        },
      },
    }),
    [chartPalette.muted, chartPalette.grid],
  );

  const summaryCards = useMemo(
    () => [
      { label: 'Tickets assigned', value: String(summary.assignedCount), icon: 'pi pi-inbox', accent: 'primary' },
      { label: 'Tickets closed', value: String(summary.closedCount), icon: 'pi pi-check-circle', accent: 'success' },
      { label: 'Active assigned', value: String(summary.activeAssigned), icon: 'pi pi-briefcase', accent: 'info' },
      { label: 'Efficiency', value: `${summary.efficiency}%`, icon: 'pi pi-chart-line', accent: 'warning' },
      { label: 'Avg close period', value: summary.avgCloseDays === null ? '—' : `${summary.avgCloseDays.toFixed(1)} days`, icon: 'pi pi-clock', accent: 'secondary' },
      { label: 'Events attended', value: String(summary.eventsAttended), icon: 'pi pi-calendar', accent: 'mint' },
      { label: 'Current role', value: currentUserRoleLabel, icon: 'pi pi-id-card', accent: 'secondary' },
      { label: 'Employee ID', value: currentUserIdentifier, icon: 'pi pi-user', accent: 'info' },
      { label: 'Profile created', value: currentUserCreatedAt ? new Date(currentUserCreatedAt).toLocaleString() : '—', icon: 'pi pi-history', accent: 'primary' },
    ],
    [summary, currentUserRoleLabel, currentUserIdentifier, currentUserCreatedAt],
  );

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
        <div className="header-notifications">
          <button
            type="button"
            className={`notification-btn ${isNotificationModalOpen ? 'notification-btn--open' : ''}`}
            onClick={() => setIsNotificationModalOpen(true)}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={16} />
            {notifications.filter((n) => !n.is_read).length ? (
              <span className="notification-badge">{notifications.filter((n) => !n.is_read).length}</span>
            ) : null}
          </button>
        </div>
        <div className="user-chip">
          {currentUserAvatarUrl ? (
            <img src={currentUserAvatarUrl} alt="" className="user-avatar user-avatar-img" />
          ) : (
            <span className="user-avatar">{currentUserAvatar}</span>
          )}
          <div className="user-meta">
            <strong>{currentUserName}</strong>
            <span className="user-submeta">
              <small>{currentUserRoleLabel}</small>
              <small>{currentUserIdentifier}</small>
            </span>
          </div>
        </div>
        <button className="settings-btn" onClick={() => setIsSettingsModalOpen(true)} type="button" title="Settings" aria-label="Settings">
          <Settings size={16} />
        </button>
        <button className="logout-btn" onClick={onLogout} type="button">
          <LogOut size={16} />
          Logout
        </button>
      </div>
      <Dialog
        header="Approval notifications"
        visible={isNotificationModalOpen}
        onHide={() => setIsNotificationModalOpen(false)}
        style={{ width: 'min(720px, 95vw)' }}
        className="notification-dialog"
        modal
      >
        {notifications.length ? (
          <ul className="notification-list notification-list--modal">
            {notifications.map((item) => (
              <li key={item.notification_id} className={`notification-item ${item.is_read ? 'notification-item--read' : ''}`}>
                <div className="notification-item-text">
                  <strong>{item.ticket_reference ?? 'Ticket'}</strong>
                  <span>{item.ticket_title}</span>
                  <small>
                    {item.requested_by_name ? `Requested by ${item.requested_by_name}` : 'Approval requested'} ·{' '}
                    {new Date(item.requested_at).toLocaleString()}
                  </small>
                </div>
                <div className="notification-item-actions">
                  <button
                    type="button"
                    className="notification-read-btn"
                    disabled={item.is_read || notificationReadBusyId === item.notification_id}
                    onClick={() => onMarkNotificationRead?.(item.notification_id)}
                  >
                    {notificationReadBusyId === item.notification_id ? 'Marking…' : item.is_read ? 'Read' : 'Mark as read'}
                  </button>
                  <button
                    type="button"
                    className="notification-delete-btn"
                    disabled={notificationDeleteBusyId === item.notification_id}
                    onClick={() => onDeleteNotification?.(item.notification_id)}
                  >
                    {notificationDeleteBusyId === item.notification_id ? 'Deleting…' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    className="notification-ack-btn"
                    disabled={!item.request_id || notificationBusyId === item.request_id}
                    onClick={() => item.request_id && onAcknowledgeNotification?.(item.request_id)}
                  >
                    {notificationBusyId === item.request_id ? 'Closing…' : 'Acknowledge & close'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notification-empty">No notifications.</p>
        )}
      </Dialog>
      <Dialog
        header="Account settings"
        visible={isSettingsModalOpen}
        onHide={() => {
          if (!settingsBusy) {
            setIsSettingsModalOpen(false);
            setSettingsError('');
            setSettingsSuccess('');
          }
        }}
        style={{ width: '100vw', maxWidth: '100vw', height: '100vh', maxHeight: '100vh', margin: 0 }}
        className="settings-dialog settings-dialog-fullscreen"
        modal
      >
        <div className="settings-shell">
          <aside className="settings-sidebar">
            <button
              type="button"
              className={`settings-tab-btn ${activeSettingsTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveSettingsTab('details')}
            >
              Details
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${activeSettingsTab === 'preferences' ? 'active' : ''}`}
              onClick={() => setActiveSettingsTab('preferences')}
            >
              Preferences
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${activeSettingsTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveSettingsTab('summary')}
            >
              User Performance Summary
            </button>
          </aside>

          <section className="settings-content">
            {activeSettingsTab === 'details' ? (
              <div className="settings-grid">
                <div className="settings-avatar-preview-wrap settings-span-2">
                  {avatarPreviewUrl ? (
                    <div className="settings-avatar-preview-shell">
                      <img
                        src={avatarPreviewUrl}
                        alt="Avatar preview"
                        className="settings-avatar-preview"
                        style={{ transform: `scale(${avatarZoom})` }}
                      />
                    </div>
                  ) : (
                    <span className="settings-avatar-preview settings-avatar-preview-fallback">{currentUserAvatar}</span>
                  )}
                </div>
                {hasUploadedAvatar ? (
                  <div className="settings-avatar-tools settings-span-2">
                    <label className="settings-zoom-control" htmlFor="avatar-zoom-range">
                      <span>Zoom ({avatarZoom.toFixed(1)}x)</span>
                      <input
                        id="avatar-zoom-range"
                        type="range"
                        min={1}
                        max={2.4}
                        step={0.1}
                        value={avatarZoom}
                        onChange={(e) => setAvatarZoom(Number(e.target.value))}
                        disabled={settingsBusy}
                      />
                    </label>
                    <Button type="button" className="settings-avatar-reset-btn" onClick={handleResetAvatarPreview} disabled={settingsBusy} label="Reset" outlined />
                  </div>
                ) : null}
                <label>
                  Name
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-user" />
                    </span>
                    <InputText value={profileName} onChange={(e) => setProfileName(e.target.value)} disabled={settingsBusy} />
                  </div>
                </label>
                <label>
                  Email
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-envelope" />
                    </span>
                    <InputText value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} disabled={settingsBusy} />
                  </div>
                </label>
                <label>
                  Employee ID
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-id-card" />
                    </span>
                    <InputText value={currentUserIdentifier} disabled className="settings-readonly-field" />
                  </div>
                </label>
                <label>
                  Role
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-briefcase" />
                    </span>
                    <InputText value={currentUserRoleLabel} disabled className="settings-readonly-field" />
                  </div>
                </label>
                <label className="settings-span-2">
                  Upload avatar from file
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-image" />
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={settingsBusy}
                      className="settings-file-input"
                      onChange={(e) => handleAvatarFileChange(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </label>
                <div className="settings-actions settings-span-2">
                  <Button type="button" onClick={() => void handleSaveProfile()} disabled={settingsBusy} label="Save profile" icon="pi pi-check" />
                </div>
                <label className="settings-span-2">
                  New password
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-lock" />
                    </span>
                    <Password
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={settingsBusy}
                      toggleMask
                      feedback={false}
                      inputClassName="settings-password-input"
                    />
                  </div>
                </label>
                <label className="settings-span-2">
                  Confirm password
                  <div className="p-inputgroup settings-inputgroup">
                    <span className="p-inputgroup-addon">
                      <i className="pi pi-shield" />
                    </span>
                    <Password
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={settingsBusy}
                      toggleMask
                      feedback={false}
                      inputClassName="settings-password-input"
                    />
                  </div>
                </label>
                <div className="settings-actions settings-span-2">
                  <Button type="button" onClick={() => void handleSavePassword()} disabled={settingsBusy} label="Update password" icon="pi pi-key" />
                </div>
              </div>
            ) : null}

            {activeSettingsTab === 'preferences' ? (
              <div className="settings-pref">
                <label className="settings-check-row">
                  <input type="checkbox" checked={prefEmailNotifs} onChange={(e) => setPrefEmailNotifs(e.target.checked)} />
                  <span>Enable email notifications for approvals</span>
                </label>
                <label className="settings-check-row">
                  <input type="checkbox" checked={prefCompactView} onChange={(e) => setPrefCompactView(e.target.checked)} />
                  <span>Use compact table density</span>
                </label>
                <div className="settings-pref-theme-row">
                  <label className="settings-pref-field">
                    <span>Application theme</span>
                    <Dropdown
                      value={selectedTheme}
                      options={[
                        { label: 'Light Theme', value: 'light' },
                        { label: 'Dark Theme', value: 'dark' },
                        { label: 'Midnight Theme', value: 'midnight' },
                      ]}
                      onChange={(e) => setSelectedTheme(e.value as ThemePreference)}
                      className="settings-theme-dropdown"
                      disabled={settingsBusy}
                    />
                  </label>
                  <div className="settings-actions settings-actions--inline">
                    <Button type="button" label="Save preferences" icon="pi pi-check" onClick={() => void handleSavePreferences()} disabled={settingsBusy} />
                  </div>
                </div>
                <p className="settings-note">Theme preference is saved to your account and applied at login.</p>
              </div>
            ) : null}

            {activeSettingsTab === 'summary' ? (
              <div className="settings-summary-wrap">
                <div className="settings-summary-filters">
                  <span>Time filter</span>
                  <Dropdown
                    value={summaryRange}
                    options={[
                      { label: 'Last 7 days', value: '7d' },
                      { label: 'Last 30 days', value: '30d' },
                      { label: 'Last 90 days', value: '90d' },
                      { label: 'Last 12 months', value: '365d' },
                      { label: 'All time', value: 'all' },
                    ]}
                    onChange={(e) => setSummaryRange(e.value as '7d' | '30d' | '90d' | '365d' | 'all')}
                    className="settings-summary-range"
                  />
                </div>
                <div className="settings-summary">
                  {summaryCards.map((card, idx) => (
                    <motion.div
                      key={card.label}
                      className={`settings-summary-card settings-summary-card--premium settings-summary-card--${card.accent}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, delay: Math.min(idx * 0.03, 0.24) }}
                      whileHover={{ y: -2, scale: 1.01 }}
                    >
                      <div className="settings-summary-card-head">
                        <span>{card.label}</span>
                        <i className={card.icon} />
                      </div>
                      <strong>{card.value}</strong>
                    </motion.div>
                  ))}
                </div>
                <div className="settings-summary-charts">
                  <motion.div className="settings-summary-chart-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.15 }}>
                    <span>Ticket status distribution</span>
                    <div className="settings-summary-chart">
                      <Chart type="doughnut" data={ticketStatusChartData} options={ticketStatusChartOptions} />
                    </div>
                  </motion.div>
                  <motion.div className="settings-summary-chart-card settings-summary-chart-card--wide" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.22 }}>
                    <span>Ticket trend</span>
                    <div className="settings-summary-chart">
                      <Chart type="line" data={ticketTrendChartData} options={ticketTrendChartOptions} />
                    </div>
                  </motion.div>
                </div>
                <p className="settings-note">Metrics are computed from accessible tickets and events for the selected period.</p>
              </div>
            ) : null}

            {settingsError ? <p className="settings-error">{settingsError}</p> : null}
            {settingsSuccess ? <p className="settings-success">{settingsSuccess}</p> : null}
          </section>
        </div>
      </Dialog>
    </header>
  );
}
