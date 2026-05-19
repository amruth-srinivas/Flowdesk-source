/** Shared rules for creating / saving an open ticket from the UI. */
export function ticketDraftValidationMessage(opts: {
  projectId: string | null;
  title: string;
  description: string;
  assigneeIds: string[];
  customerId: string | null;
  dueDate: Date | null;
}): string | null {
  if (!opts.projectId?.trim()) {
    return 'Select a project.';
  }
  if (!opts.title.trim()) {
    return 'Enter a title.';
  }
  if (!opts.description.trim()) {
    return 'Enter a description.';
  }
  if (!opts.assigneeIds.length) {
    return 'Select at least one assignee.';
  }
  if (!opts.customerId) {
    return 'Select a customer.';
  }
  if (!opts.dueDate) {
    return 'Select a due date.';
  }
  return null;
}

export function isTicketDraftValid(opts: Parameters<typeof ticketDraftValidationMessage>[0]): boolean {
  return ticketDraftValidationMessage(opts) === null;
}
