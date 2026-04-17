import type { ReactNode } from 'react';

type TicketsPageProps = {
  content: ReactNode;
};

export function TicketsPage({ content }: TicketsPageProps) {
  return <>{content}</>;
}
