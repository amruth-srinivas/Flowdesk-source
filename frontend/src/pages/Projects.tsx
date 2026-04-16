import type { ReactNode } from 'react';
import { ProjectsViewModule } from './modules/projects/ProjectsViewModule';
import { UserManagementModule } from './modules/projects/UserManagementModule';

type ProjectsPageProps = {
  activeModule: string;
  viewContent: ReactNode;
  userManagementContent: ReactNode;
  fallbackContent: ReactNode;
};

export function ProjectsPage({ activeModule, viewContent, userManagementContent, fallbackContent }: ProjectsPageProps) {
  if (activeModule === 'View') {
    return <ProjectsViewModule content={viewContent} />;
  }

  if (activeModule === 'User Management') {
    return <UserManagementModule content={userManagementContent} />;
  }

  return <>{fallbackContent}</>;
}
