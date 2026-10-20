import { z } from 'zod';
import { CENTER_MODULE_IDS, type CenterModuleId } from './center-modules';

function buildModuleShape<Value extends z.ZodType>(
  buildValue: () => Value,
): Record<CenterModuleId, Value> {
  return Object.fromEntries(CENTER_MODULE_IDS.map((id) => [id, buildValue()])) as Record<
    CenterModuleId,
    Value
  >;
}

/** Lo que el centro usa: un booleano por módulo. */
export const centerModulesSchema = z.strictObject(buildModuleShape(() => z.boolean()));

/** Lo que la administración cambia: solo los módulos enviados. */
export const centerModuleChangesSchema = z
  .strictObject(buildModuleShape(() => z.boolean().optional()))
  .refine((changes) => Object.keys(changes).length > 0, 'send at least one module');
