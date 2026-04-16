import type { ReactNode } from 'react';

type UserManagementModuleProps = {
  content: ReactNode;
};

export function UserManagementModule({ content }: UserManagementModuleProps) {
  return <>{content}</>;
}
