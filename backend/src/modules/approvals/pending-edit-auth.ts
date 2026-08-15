import { Role } from '@prisma/client';
import { AppError } from '../../utils/helpers';

export type PendingEditor = {
  id: number;
  role: Role;
};

/** Admin may edit any pending invoice; users may edit only their own invoices. */
export function assertCanEditPendingInvoice(
  editor: PendingEditor,
  createdById: number | null | undefined,
) {
  if (editor.role === Role.ADMIN) return;
  if (createdById != null && createdById === editor.id) return;
  throw new AppError(403, 'You can only edit your own pending invoices');
}

/** Pending voucher edit is Admin-only. */
export function assertCanEditPendingVoucher(editor: PendingEditor) {
  if (editor.role === Role.ADMIN) return;
  throw new AppError(403, 'Only Admin can edit pending vouchers');
}

/** @deprecated Use assertCanEditPendingInvoice / assertCanEditPendingVoucher */
export function assertCanEditPending(
  editor: PendingEditor,
  createdById: number | null | undefined,
) {
  assertCanEditPendingInvoice(editor, createdById);
}
