import { Inject, Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  classifyImportRows,
  type ImportRow,
  type ImportRowSkipReason,
} from '../domain/client-import-rules';
import {
  CLIENT_IMPORT_REPOSITORY,
  type ClientImportRepository,
  type ImportRowOutcome,
} from './ports/client-import.repository';

export interface ClientImportReport {
  readonly createdCount: number;
  readonly updatedCount: number;
  /** Filas que no se importaron y por qué, con su número de fila en el archivo. */
  readonly skipped: readonly {
    readonly rowNumber: number;
    readonly email: string | null;
    readonly reason: ImportRowSkipReason | Exclude<ImportRowOutcome, 'created' | 'updated'>;
  }[];
}

@Injectable()
export class ImportClientsUseCase {
  constructor(@Inject(CLIENT_IMPORT_REPOSITORY) private readonly imports: ClientImportRepository) {}

  async execute(actor: ActorContext, rows: readonly ImportRow[]): Promise<ClientImportReport> {
    const { importable, skipped: skippedByRules } = classifyImportRows(rows);
    const results = await this.imports.importClients(actor, importable);

    const rowNumberByEmail = new Map(
      rows.map((row, index) => [row.email?.toLowerCase() ?? '', index + 1] as const).reverse(),
    );
    const skippedByOutcome = results.flatMap(({ email, outcome }) =>
      outcome === 'created' || outcome === 'updated'
        ? []
        : [{ rowNumber: rowNumberByEmail.get(email) ?? 0, email, reason: outcome }],
    );

    return {
      createdCount: results.filter(({ outcome }) => outcome === 'created').length,
      updatedCount: results.filter(({ outcome }) => outcome === 'updated').length,
      skipped: [
        ...skippedByRules.map(({ rowNumber, reason }) => ({
          rowNumber,
          email: rows[rowNumber - 1]?.email ?? null,
          reason,
        })),
        ...skippedByOutcome,
      ].sort((first, second) => first.rowNumber - second.rowNumber),
    };
  }
}
