import type { ReactNode } from 'react';

type ArticlesModuleProps = {
  content: ReactNode;
};

export function ArticlesModule({ content }: ArticlesModuleProps) {
  return <>{content}</>;
}
