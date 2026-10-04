const NULL_TYPE = 'null';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `type: ['string', 'null']` → `type: 'string', nullable: true`; otro tipo de unión se deja como está. */
function normalizeTypeArray(schema: Record<string, unknown>): void {
  const { type } = schema;
  if (!Array.isArray(type) || !type.includes(NULL_TYPE)) return;

  const concreteTypes = type.filter((entry) => entry !== NULL_TYPE);
  if (concreteTypes.length !== 1) return;
  schema['type'] = concreteTypes[0];
  schema['nullable'] = true;
}

/**
 * El contrato se declara OpenAPI 3.0 (lo que entiende Orval), pero zod genera JSON Schema 2020-12 donde
 * un valor que admite `null` es `type: [x, 'null']`. Se normaliza en todo el documento, a cualquier
 * profundidad, para que el contrato sea coherente y el generador de la app no lo rechace.
 */
export function normalizeNullableTypes<TDocument>(document: TDocument): TDocument {
  const pending: unknown[] = [document];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...(node as unknown[]));
    } else if (isRecord(node)) {
      normalizeTypeArray(node);
      pending.push(...Object.values(node));
    }
  }
  return document;
}
