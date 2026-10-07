/* eslint-disable */
// Prueba las claves de Bunny Stream del .env contra el servicio real: crea un vídeo vacío, firma una
// subida, firma un enlace de reproducción, comprueba que el CDN acepta la firma y lo borra.
// No sube ningún fichero ni deja nada en la librería. Uso: npm run videos:check
require('dotenv/config');
const {
  signCdnDirectoryUrl,
  signTusUpload,
  toUnixSeconds,
} = require('../dist/modules/videos/infrastructure/bunny-signatures');

const API = 'https://video.bunnycdn.com';
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const LIFETIME_SECONDS = 600;
const REQUIRED = ['BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_API_KEY', 'BUNNY_STREAM_CDN_HOSTNAME'];
// El CDN rechaza (403) las peticiones sin `Referer`; la app móvil manda este.
const REFERER = 'https://yoclick.app/';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

async function bunny(libraryId, apiKey, method, path, body) {
  return fetch(`${API}/library/${libraryId}${path}`, {
    method,
    headers: {
      AccessKey: apiKey,
      Accept: 'application/json',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
}

async function main() {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) return fail(`Faltan en el .env: ${missing.join(', ')}`);
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY;
  const hostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;

  const created = await bunny(libraryId, apiKey, 'POST', '/videos', { title: 'yoclick-check' });
  if (!created.ok)
    return fail(`Crear un vídeo: Bunny respondió ${created.status} (¿library id o API key?)`);
  const { guid } = await created.json();
  console.log(`✓ Vídeo de prueba creado (${guid}): el library id y la API key valen`);

  try {
    const expires = toUnixSeconds(new Date()) + LIFETIME_SECONDS;
    const signature = signTusUpload({
      libraryId,
      apiKey,
      expiresAtUnixSeconds: expires,
      providerVideoId: guid,
    });
    console.log(`✓ Firma de subida calculada (${signature.slice(0, 8)}…)`);

    const state = await bunny(libraryId, apiKey, 'GET', `/videos/${guid}`);
    console.log(state.ok ? '✓ Consulta de estado: bien' : `✗ Consulta de estado: ${state.status}`);

    const isTokenAuthEnabled = process.env.BUNNY_STREAM_TOKEN_AUTH === 'enabled';
    if (isTokenAuthEnabled && !tokenKey)
      return fail('BUNNY_STREAM_TOKEN_AUTH=enabled necesita BUNNY_STREAM_TOKEN_KEY');
    const link = isTokenAuthEnabled
      ? signCdnDirectoryUrl({
          hostname,
          tokenKey,
          directoryPath: `/${guid}/`,
          filePath: `/${guid}/playlist.m3u8`,
          expiresAtUnixSeconds: expires,
        })
      : `https://${hostname}/${guid}/playlist.m3u8`;
    console.log(
      isTokenAuthEnabled
        ? '· Probando con enlace firmado'
        : '· Probando con enlace sin firmar (BUNNY_STREAM_TOKEN_AUTH=disabled)',
    );
    const playback = await fetch(link, { headers: { Referer: REFERER } });
    // Sin fichero subido el CDN no tiene lista de reproducción: 404 significa que la firma se aceptó;
    // 403 significa que la clave del token o el dominio no son los correctos.
    if (playback.status === HTTP_FORBIDDEN) {
      fail(
        'Enlace de reproducción: el CDN lo rechaza (403). Revisa BUNNY_STREAM_TOKEN_KEY y BUNNY_STREAM_CDN_HOSTNAME, y que la autenticación por token esté activada en la librería.',
      );
    } else if (playback.status === HTTP_NOT_FOUND || playback.ok) {
      console.log('✓ Enlace de reproducción: el CDN acepta la firma');
    } else {
      fail(`Enlace de reproducción: respuesta inesperada ${playback.status}`);
    }
  } finally {
    const deleted = await bunny(libraryId, apiKey, 'DELETE', `/videos/${guid}`);
    console.log(
      deleted.ok
        ? '✓ Vídeo de prueba borrado'
        : `✗ No se pudo borrar el vídeo de prueba ${guid}: bórralo a mano en Bunny`,
    );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : 'Fallo inesperado'));
