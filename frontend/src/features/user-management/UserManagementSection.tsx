import { motion } from 'framer-motion';
import { KeyRound, Mail } from 'lucide-react';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { FloatLabel } from 'primereact/floatlabel';
import { InputSwitch } from 'primereact/inputswitch';
import { InputText } from 'primereact/inputtext';
import { Tag } from 'primereact/tag';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import type { BackendRole, UserRecord } from '../../lib/api';

type UserManagementSectionProps = {
  viewKey: string;
  userSearch: string;
  onUserSearchChange: (value: string) => void;
  onOpenCreateUserDialog: () => void;
  userManagementError: string;
  filteredUsers: UserRecord[];
  isUsersLoading: boolean;
  renderRoleTag: (value: BackendRole) => ReactNode;
  onOpenEditUserDialog: (user: UserRecord) => void;
  onOpenPasswordDialog: (user: UserRecord) => void;
  dialogMode: 'create' | 'edit';
  isUserDialogOpen: boolean;
  onCloseUserDialog: () => void;
  handleCreateUser: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleEditUser: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  createForm: { employeeId: string; name: string; email: string; password: string; role: BackendRole | '' };
  editForm: { employeeId: string; name: string; email: string; role: BackendRole; isActive: boolean };
  setCreateForm: Dispatch<SetStateAction<{ employeeId: string; name: string; email: string; password: string; role: BackendRole | '' }>>;
  setEditForm: Dispatch<SetStateAction<{ id: string; employeeId: string; name: string; email: string; role: BackendRole; isActive: boolean }>>;
  showCreatePassword: boolean;
  setShowCreatePassword: (updater: (current: boolean) => boolean) => void;
  optionalRoleOptions: Array<{ label: string; value: string }>;
  backendRoleOptions: Array<{ label: string; value: BackendRole }>;
  userFormError: string;
  isSavingUser: boolean;
  isPasswordDialogOpen: boolean;
  onClosePasswordDialog: () => void;
  handlePasswordChange: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  passwordForm: { name: string; password: string; confirmPassword: string };
  setPasswordForm: Dispatch<SetStateAction<{ id: string; name: string; password: string; confirmPassword: string }>>;
  showNewPassword: boolean;
  setShowNewPassword: (updater: (current: boolean) => boolean) => void;
  showConfirmPassword: boolean;
  setShowConfirmPassword: (updater: (current: boolean) => boolean) => void;
  passwordFormError: string;
  isSavingPassword: boolean;
};

export function UserManagementSection(props: UserManagementSectionProps) {
  const {
    viewKey,
    userSearch,
    onUserSearchChange,
    onOpenCreateUserDialog,
    userManagementError,
    filteredUsers,
    isUsersLoading,
    renderRoleTag,
    onOpenEditUserDialog,
    onOpenPasswordDialog,
    dialogMode,
    isUserDialogOpen,
    onCloseUserDialog,
    handleCreateUser,
    handleEditUser,
    createForm,
    editForm,
    setCreateForm,
    setEditForm,
    showCreatePassword,
    setShowCreatePassword,
    optionalRoleOptions,
    backendRoleOptions,
    userFormError,
    isSavingUser,
    isPasswordDialogOpen,
    onClosePasswordDialog,
    handlePasswordChange,
    passwordForm,
    setPasswordForm,
    showNewPassword,
    setShowNewPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    passwordFormError,
    isSavingPassword,
  } = props;

  return (
    <motion.article key={viewKey} className="page-card user-management-page" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="user-table-shell">
        <div className="user-table-toolbar">
          <div />
          <div className="project-page-actions">
            <div className="table-search">
              <input placeholder="Search users..." value={userSearch} onChange={(event) => onUserSearchChange(event.target.value)} />
            </div>
            <Button label="Add User" icon="pi pi-user-plus" onClick={onOpenCreateUserDialog} />
          </div>
        </div>
        {userManagementError ? <small className="error-text">{userManagementError}</small> : null}
        <DataTable value={filteredUsers} loading={isUsersLoading} paginator rows={6} rowsPerPageOptions={[6, 10, 20]} className="user-table" emptyMessage="No users found.">
          <Column field="name" header="Name" body={(user: UserRecord) => <div className="user-name-cell"><strong>{user.name}</strong><span>{user.employee_id}</span></div>} />
          <Column field="email" header="Email" body={(user: UserRecord) => <span className="muted-cell">{user.email}</span>} />
          <Column field="role" header="Role" body={(user: UserRecord) => renderRoleTag(user.role)} />
          <Column field="is_active" header="Status" body={(user: UserRecord) => <Tag value={user.is_active ? 'Active' : 'Inactive'} severity={user.is_active ? 'success' : 'secondary'} rounded />} />
          <Column field="created_at" header="Created" body={(user: UserRecord) => <span className="muted-cell">{new Date(user.created_at).toLocaleDateString()}</span>} />
          <Column
            header="Actions"
            body={(user: UserRecord) => (
              <div className="user-actions-cell">
                <Button type="button" label="Edit" icon="pi pi-pencil" severity="secondary" text onClick={() => onOpenEditUserDialog(user)} />
                <Button type="button" label="Password" icon="pi pi-key" text onClick={() => onOpenPasswordDialog(user)} />
              </div>
            )}
          />
        </DataTable>
      </div>

      <Dialog header={dialogMode === 'create' ? 'Create New User' : 'Edit User'} visible={isUserDialogOpen} onHide={onCloseUserDialog} className="user-dialog" modal>
        <form onSubmit={dialogMode === 'create' ? handleCreateUser : handleEditUser} className="user-form">
          <div className="form-grid">
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-id-card" /></span><FloatLabel className="user-float-field"><InputText id="user-employee-id" value={dialogMode === 'create' ? createForm.employeeId : editForm.employeeId} onChange={(event) => dialogMode === 'create' ? setCreateForm((current) => ({ ...current, employeeId: event.target.value })) : setEditForm((current) => ({ ...current, employeeId: event.target.value }))} /><label htmlFor="user-employee-id">Employee ID</label></FloatLabel></div>
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-user" /></span><FloatLabel className="user-float-field"><InputText id="user-name" value={dialogMode === 'create' ? createForm.name : editForm.name} onChange={(event) => dialogMode === 'create' ? setCreateForm((current) => ({ ...current, name: event.target.value })) : setEditForm((current) => ({ ...current, name: event.target.value }))} /><label htmlFor="user-name">Full name</label></FloatLabel></div>
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><Mail size={16} /></span><FloatLabel className="user-float-field"><InputText id="user-email" value={dialogMode === 'create' ? createForm.email : editForm.email} onChange={(event) => dialogMode === 'create' ? setCreateForm((current) => ({ ...current, email: event.target.value })) : setEditForm((current) => ({ ...current, email: event.target.value }))} /><label htmlFor="user-email">Email address</label></FloatLabel></div>
            {dialogMode === 'create' ? <div className="p-inputgroup"><span className="p-inputgroup-addon"><KeyRound size={16} /></span><FloatLabel className="user-float-field"><InputText id="user-password" type={showCreatePassword ? 'text' : 'password'} value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} /><label htmlFor="user-password">Temporary password</label></FloatLabel><button type="button" className="password-toggle-btn" onClick={() => setShowCreatePassword((current) => !current)} aria-label={showCreatePassword ? 'Hide password' : 'Show password'}><i className={showCreatePassword ? 'pi pi-eye-slash' : 'pi pi-eye'} /></button></div> : null}
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><i className="pi pi-briefcase" /></span><FloatLabel className="user-float-field"><Dropdown id="user-role" value={dialogMode === 'create' ? createForm.role : editForm.role} options={dialogMode === 'create' ? optionalRoleOptions : backendRoleOptions} onChange={(event) => dialogMode === 'create' ? setCreateForm((current) => ({ ...current, role: event.value as BackendRole | '' })) : setEditForm((current) => ({ ...current, role: event.value as BackendRole }))} className="full-width" /><label htmlFor="user-role">{dialogMode === 'create' ? 'Workspace role (optional)' : 'Workspace role'}</label></FloatLabel></div>
          </div>
          {dialogMode === 'create' ? <small className="helper-text">Role selection can be skipped for now. The user will start as a team member until a project assignment is made.</small> : <label className="status-toggle"><div><strong>Account status</strong><small>Disable sign-in without removing the user from records.</small></div><InputSwitch checked={editForm.isActive} onChange={(event) => setEditForm((current) => ({ ...current, isActive: Boolean(event.value) }))} /></label>}
          {userFormError ? <small className="error-text">{userFormError}</small> : null}
          <div className="dialog-actions"><Button type="button" label="Cancel" text onClick={onCloseUserDialog} /><Button type="submit" label={dialogMode === 'create' ? (isSavingUser ? 'Creating...' : 'Create User') : isSavingUser ? 'Saving...' : 'Save Changes'} loading={isSavingUser} /></div>
        </form>
      </Dialog>

      <Dialog header={`Change Password${passwordForm.name ? ` for ${passwordForm.name}` : ''}`} visible={isPasswordDialogOpen} onHide={onClosePasswordDialog} className="user-dialog" modal>
        <form onSubmit={handlePasswordChange} className="user-form">
          <div className="form-grid">
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><KeyRound size={16} /></span><FloatLabel className="user-float-field"><InputText id="new-password" type={showNewPassword ? 'text' : 'password'} value={passwordForm.password} onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))} /><label htmlFor="new-password">New password</label></FloatLabel><button type="button" className="password-toggle-btn" onClick={() => setShowNewPassword((current) => !current)} aria-label={showNewPassword ? 'Hide password' : 'Show password'}><i className={showNewPassword ? 'pi pi-eye-slash' : 'pi pi-eye'} /></button></div>
            <div className="p-inputgroup"><span className="p-inputgroup-addon"><KeyRound size={16} /></span><FloatLabel className="user-float-field"><InputText id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} /><label htmlFor="confirm-password">Confirm password</label></FloatLabel><button type="button" className="password-toggle-btn" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}><i className={showConfirmPassword ? 'pi pi-eye-slash' : 'pi pi-eye'} /></button></div>
          </div>
          {passwordFormError ? <small className="error-text">{passwordFormError}</small> : null}
          <div className="dialog-actions"><Button type="button" label="Cancel" text onClick={onClosePasswordDialog} /><Button type="submit" label={isSavingPassword ? 'Updating...' : 'Update Password'} loading={isSavingPassword} /></div>
        </form>
      </Dialog>
    </motion.article>
  );
}
