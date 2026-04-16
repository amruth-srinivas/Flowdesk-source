import type { ReactNode } from 'react';

type ConfigurationModuleProps = {
  content: ReactNode;
};

export function ConfigurationModule({ content }: ConfigurationModuleProps) {
  return <>{content}</>;
}
