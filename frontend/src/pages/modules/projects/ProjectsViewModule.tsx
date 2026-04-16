import type { ReactNode } from 'react';

type ProjectsViewModuleProps = {
  content: ReactNode;
};

export function ProjectsViewModule({ content }: ProjectsViewModuleProps) {
  return <>{content}</>;
}
