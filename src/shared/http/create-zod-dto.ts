import { createZodDto as createNestZodDto } from 'nestjs-zod';
import { type ZodType } from 'zod';
import { normalizeNullableTypes } from '../../openapi/normalize-nullable-types';

type ZodDtoClass<TSchema extends ZodType> = ReturnType<typeof createNestZodDto<TSchema>>;

interface WithOpenApiMetadata {
  // Nombre fijado por nestjs-zod / @nestjs/swagger.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _OPENAPI_METADATA_FACTORY: () => unknown;
}

/**
 * `createZodDto` de nestjs-zod, con una corrección para el contrato: un campo `z.string().nullable()` sale
 * como `type: ['string', 'null']` y el generador de OpenAPI de Nest lo convierte en un array de textos.
 * Aquí se normaliza a `type: 'string', nullable: true` antes de que Nest lo vea.
 */
export function createZodDto<TSchema extends ZodType>(schema: TSchema): ZodDtoClass<TSchema> {
  const dtoClass = createNestZodDto(schema);
  const dtoWithMetadata = dtoClass as unknown as WithOpenApiMetadata;
  const originalFactory = dtoWithMetadata._OPENAPI_METADATA_FACTORY.bind(dtoClass);
  dtoWithMetadata._OPENAPI_METADATA_FACTORY = () => normalizeNullableTypes(originalFactory());
  return dtoClass;
}
