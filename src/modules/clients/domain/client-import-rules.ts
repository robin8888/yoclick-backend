import { type ClientLevelName } from './client-rules';

export { UNUSABLE_PASSWORD_HASH } from '../../../shared/auth/unactivated-account';

export const MAX_IMPORT_ROWS = 500;

export interface ImportRow {
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly level: ClientLevelName | null;
}

export type ImportRowSkipReason = 'missing_email' | 'duplicated_in_file';

export interface ClassifiedImportRows {
  readonly importable: readonly ImportRow[];
  readonly skipped: readonly { readonly rowNumber: number; readonly reason: ImportRowSkipReason }[];
}

/**
 * Separa lo que se puede importar de lo que no. Sin correo no hay cuenta a la que colgar la
 * membresía; si una misma dirección aparece varias veces vale la primera fila. Los números de fila
 * empiezan en 1 y no cuentan la cabecera, como los ve la persona en su hoja de cálculo.
 */
export function classifyImportRows(rows: readonly ImportRow[]): ClassifiedImportRows {
  const importable: ImportRow[] = [];
  const skipped: { rowNumber: number; reason: ImportRowSkipReason }[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.email === null) {
      skipped.push({ rowNumber, reason: 'missing_email' });
      return;
    }
    const email = row.email.toLowerCase();
    if (seenEmails.has(email)) {
      skipped.push({ rowNumber, reason: 'duplicated_in_file' });
      return;
    }
    seenEmails.add(email);
    importable.push({ ...row, email });
  });
  return { importable, skipped };
}

export type ImportRowAction =
  'blocked' | 'team_member' | 'update_existing_client' | 'client_limit_reached' | 'add_as_client';

export interface ExistingMembershipFacts {
  readonly role: 'owner' | 'admin' | 'staff' | 'client';
  readonly status: 'invited' | 'active' | 'blocked' | 'left';
}

/** `remainingSeats` es `null` cuando el plan no tiene tope de clientes. */
export function decideImportRowAction(facts: {
  readonly membership: ExistingMembershipFacts | null;
  readonly remainingSeats: number | null;
}): ImportRowAction {
  const { membership, remainingSeats } = facts;
  if (membership?.status === 'blocked') return 'blocked';
  if (membership && membership.role !== 'client') return 'team_member';
  if (membership?.status === 'active') return 'update_existing_client';
  return remainingSeats === 0 ? 'client_limit_reached' : 'add_as_client';
}
