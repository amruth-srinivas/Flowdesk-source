import type { ReactNode } from 'react';
import { ArticlesModule } from './modules/knowledge-base/ArticlesModule';
import { ConfigurationModule } from './modules/knowledge-base/ConfigurationModule';
import { CustomersModule } from './modules/knowledge-base/CustomersModule';

type KnowledgeBasePageProps = {
  activeModule: string;
  configurationContent: ReactNode;
  articlesContent: ReactNode;
  customersContent: ReactNode;
  fallbackContent: ReactNode;
};

export function KnowledgeBasePage({
  activeModule,
  configurationContent,
  articlesContent,
  customersContent,
  fallbackContent,
}: KnowledgeBasePageProps) {
  if (activeModule === 'Configuration') {
    return <ConfigurationModule content={configurationContent} />;
  }

  if (activeModule === 'Articles') {
    return <ArticlesModule content={articlesContent} />;
  }

  if (activeModule === 'Customers') {
    return <CustomersModule content={customersContent} />;
  }

  return <>{fallbackContent}</>;
}
