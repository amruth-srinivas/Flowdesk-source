import type { ReactNode } from 'react';

type CustomersModuleProps = {
  content: ReactNode;
};

export function CustomersModule({ content }: CustomersModuleProps) {
  return <>{content}</>;
}
