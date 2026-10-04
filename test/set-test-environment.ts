// Los tests no deben ensuciar la salida ni depender del .env de quien los ejecuta.
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
