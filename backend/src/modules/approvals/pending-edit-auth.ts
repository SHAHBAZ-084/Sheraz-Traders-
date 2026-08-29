import { Role } from '@prisma/client';
import { AppError } from '../../utils/helpers';

export type PendingEditor = {
  id: number;
  role: Role;
};

/** Admin may edit any pending record; users may edit only their own. */
export function assertCanEditPendingRecord(
  editor: PendingEditor,
  createdById: number | null | undefined,
  label = 'pending item',
) {
  if (editor.role === Role.ADMIN) return;
  if (createdById != null && createdById === editor.id) return;
  throw new AppError(403, `You can only edit your own ${label}`);
}

/** Admin may edit any pending invoice; users may edit only their own invoices. */
export function assertCanEditPendingInvoice(
  editor: PendingEditor,
  createdById: number | null | undefined,
) {
  assertCanEditPendingRecord(editor, createdById, 'pending invoices');
}

/** Admin may edit any pending voucher; users may edit only their own. */
export function assertCanEditPendingVoucher(
  editor: PendingEditor,
  createdById?: number | null,
) {
  assertCanEditPendingRecord(editor, createdById, 'pending vouchers');
}

/** @deprecated Use assertCanEditPendingInvoice / assertCanEditPendingVoucher */
export function assertCanEditPending(
  editor: PendingEditor,
  createdById: number | null | undefined,
) {
  assertCanEditPendingInvoice(editor, createdById);
}
