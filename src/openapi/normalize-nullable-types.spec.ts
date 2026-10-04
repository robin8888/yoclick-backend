import { normalizeNullableTypes } from './normalize-nullable-types';

describe('normalizeNullableTypes', () => {
  it('turns a nullable type array into type + nullable, at any depth', () => {
    const document = {
      components: {
        schemas: {
          Center: {
            properties: {
              city: { type: ['string', 'null'] },
              nested: { items: { properties: { distance: { type: ['number', 'null'] } } } },
            },
          },
        },
      },
    };

    expect(normalizeNullableTypes(document)).toEqual({
      components: {
        schemas: {
          Center: {
            properties: {
              city: { type: 'string', nullable: true },
              nested: {
                items: { properties: { distance: { type: 'number', nullable: true } } },
              },
            },
          },
        },
      },
    });
  });

  it('leaves plain types, anyOf unions and multi-type arrays alone', () => {
    const document = {
      plain: { type: 'string' },
      union: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      multi: { type: ['string', 'number'] },
    };

    expect(normalizeNullableTypes(structuredClone(document))).toEqual(document);
  });
});
