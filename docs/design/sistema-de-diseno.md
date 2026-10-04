Sistema visual de una app de gestión que se vende en marca blanca para cualquier centro con clases o citas, clientes o alumnos e instructores o profesores: gimnasios, estudios, centros de readaptación, yoga y pilates, academias de baile, artes marciales, escuelas de música y de cocina, academias de idiomas o refuerzo. La plataforma no tiene cara propia dentro de la app: el cliente final ve el logo, el nombre y el color de SU centro. Por eso todo lo que no es marca es neutro, y el color del gimnasio entra por cuatro variables calculadas (ver BrandEngine). Abre **Prototipo** para navegar el producto completo.

## Principios

- **La marca es del gimnasio.** `Yoclick` solo aparece antes de que el cliente se una a su centro (pantallas Unirse, con marca neutra: `brand` = `ink`), en el alta de gimnasio y en el panel web de plataforma. Desde que el cliente se une, todo lleva el logo, el nombre y el color del gimnasio.
- **Una app, muchos centros.** Planes Básico y Pro: una única app en las tiendas con el icono de la plataforma; el cliente se une por QR, código de 6 caracteres o búsqueda, y puede pertenecer a varios centros (Mis centros). Plan Premium: compilación propia con el icono y el nombre del gimnasio, publicada desde la cuenta de desarrollador del gimnasio.
- **Neutro primero, un color después.** Las superficies (`bg`, `surface`, `surface-2`) y la tinta (`ink`, `ink-2`) cargan el 90 % de la interfaz. `brand` aparece en la acción principal, lo seleccionado y la próxima cita.
- **AA con cualquier color.** Ningún texto se pinta con el hex del gimnasio: sobre `brand` va `on-brand`; como texto va `brand-ink`. Ambos se calculan (BrandEngine) y cumplen 4,5:1 en claro y oscuro.
- **Deportivo, no agresivo.** Titulares expandidos y compactos, cifras grandes, esquinas generosas, movimiento corto y con rebote leve.

## Contenido y tono

- Español de España, tuteo: «Reserva tu siguiente sesión», «Te queda 1 para tu objetivo». Nunca «usted».
- Mayúscula solo inicial: «Agendar cita», «Mis citas». Los rótulos `overline` van en mayúsculas por CSS, escritos en minúscula.
- Botones: verbo en infinitivo — «Reservar cita», «Guardar cambios», «Publicar cambios». Confirmaciones destructivas nombran el objeto: «Sí, cancelar cita» / «Mantener cita».
- Avisos: quién, qué y cuándo en una frase — «Álex Moreno ha cambiado tu cita. Readaptación de lesiones del lun 5 oct pasa de las 10:00 a las 09:00.»
- Fechas: «jue 1 oct», horas en 24 h «18:00», duraciones «60 min». Números con coma decimal y punto de miles: «12.480 €», «4,6:1».
- Sin emoji ni lorem ipsum. Datos de ejemplo verosímiles y marcados «DEMO» (pastilla `warning` en la barra de estado).

## Color

- Fondo de pantalla `bg`; tarjetas, hojas y barra de pestañas `surface`; chips apagados, pistas y botón secundario `surface-2`.
- Texto principal `ink`; metadatos `ink-2`. Ambos pasan 5,8:1 o más sobre las tres superficies en los dos temas.
- Separadores `line` (decorativos). Bordes de campo, slot y botón outline `line-strong` (3:1 o más).
- Marca: rellenos `brand` con contenido `on-brand`; texto e iconos activos `brand-ink`; tintes `brand-soft`. Los valores de `tokens.json` son los de Studio Norte (#E4572E) como ejemplo; en tiempo de ejecución se sobrescriben por gimnasio.
- Estados `success`, `warning`, `danger`, `info`, cada uno con su `-soft` para fondos de insignia. Siempre acompañados de palabra o icono; `success` y `danger` se distinguen también por texto («Confirmada», «Cancelada»).
- Anillo de foco `focus` (azul, independiente de la marca), 2,5 px con 2 px de separación.
- Tema oscuro: mismo sistema con superficies casi negras (`bg` #0D0E10). La marca no cambia su hex; cambian `brand-ink` (se aclara) y `brand-soft`.

## Tipografía

- Dos familias de Google Fonts: **Archivo** (`display`, con eje de anchura; usar `font-stretch: 112%` en titulares) y **Figtree** (`sans`, todo lo demás).
- `display` 34/36 800 solo para el saludo de Inicio y la bienvenida. `title-lg` 24/28 para el título de cada pantalla. `metric` 28/30 800 con cifras tabulares para progreso y KPIs.
- `title-md` 18/24 para secciones; `body` 15/22; `body-strong` para nombres de servicio y botones; `caption` 13/18 para metadatos; `overline` 11/14 con 0,08 em para rótulos.

## Espacio, forma y profundidad

- Rejilla de 4 px. Margen lateral de pantalla `space-4` (16 px en 390 px); entre secciones `space-6`; dentro de tarjetas `space-4`.
- Objetivos táctiles de 44 px como mínimo; botones de 48 px.
- Radios: `radius-sm` slots, `radius-md` botones y campos, `radius-lg` tarjetas, `radius-xl` hojas inferiores, `radius-pill` chips e insignias.
- Tarjetas con borde `line` y `shadow-card`; hojas inferiores con `shadow-sheet` sobre velo `scrim`.

## Movimiento

- Duraciones en `bundle.css`: 120 ms (pulsación), 220 ms (color), 380 ms (entradas y transiciones). Curva `--ease-out`; `--ease-spring` solo para elementos que «aparecen» (contador, pestaña activa, confirmación).
- Transición entre pantallas: avanzar entra desde la derecha, volver desde la izquierda, cambio de pestaña con fundido.
- Contenido de cada pantalla con entrada escalonada (`nf-stagger`, 40 ms por elemento).
- Pulsar: escala 0,97 (botones), 0,92 (botón icono). Confirmación de reserva: círculo `brand` con check dibujado y ráfaga de piezas.
- `prefers-reduced-motion`: todas las animaciones pasan a 1 ms.

## Iconografía

- Iconos de trazo 1,8 px en rejilla de 24, extremos redondeados, dibujados a mano para el prototipo (inline SVG, `currentColor`). Tamaños 22 px (navegación) y 18 px (en línea). Sustituibles por Lucide, que comparte el mismo estilo.
- Color del icono: `ink` por defecto, `brand-ink` si está activo, color de estado en avisos.

## Patrones de producto

- **Cobro al reservar:** la hoja de confirmación siempre dice cómo se paga (bono, cuota, ahora o en el centro) antes del botón; el botón dice el importe cuando se paga ahora («Pagar 35 € y reservar»).
- **Cancelar:** la hoja explica si está dentro de plazo y qué pasa con el bono o el dinero, con `note` en `success` (a tiempo) o `warning` (fuera de plazo). El botón destructivo dice «Cancelar igualmente» fuera de plazo.
- **Lista de espera:** estado `info` con la posición («Eres el nº 3»); al liberarse una plaza, aviso inmediato y la cita pasa a Confirmada.
- **Consentimientos:** casillas separadas, sin marcar por defecto, con «Obligatorio» u «Opcional» escrito; solo privacidad bloquea el botón. Salud y menores siempre explícitos.
- **Menores:** la persona que reserva elige «¿Para quién?»; la cita muestra «Para Lucas» en `brand-ink`.
- **Estados:** esqueletos (`.sk`) si la carga pasa de 300 ms; vacíos con la siguiente acción; errores sin culpar y con reintento; sin conexión con una franja `ink` fija arriba.
- **Acciones destructivas:** confirmación en hoja inferior con el objeto nombrado; para borrar la cuenta, escribir ELIMINAR.

## Tipo de centro y vocabulario

- Al darse de alta, cada centro elige su tipo. El tipo NO cambia el diseño; cambia las palabras, los niveles y los contenidos de ejemplo.
- Deporte y salud (gimnasio, estudio, readaptación, box, yoga y pilates): instructor / coach / profesional, cliente, sesiones, pestaña «Entrenar», niveles Inicio · Base · Avanzado.
- Academias y escuelas (academia, baile, artes marciales, música, cocina): profesor / maestro / chef, alumno, clases, pestaña «Practicar», «Estudiar» o «Aprender», niveles Iniciación · Intermedio · Avanzado.
- Escribe siempre con estos términos del centro, nunca «gimnasio» ni «entrenar» fijos en pantallas compartidas.

## Foto de perfil

- Clientes, alumnos, instructores y profesores pueden subir foto (cámara o galería) desde Perfil y, opcionalmente, en el registro. Se recorta cuadrada a 240 px.
- Sin foto se muestran las iniciales sobre `surface-2`. La foto aparece en Inicio, en las listas de clientes y en la agenda.

## Marca blanca: qué personaliza cada centro

- Logo (SVG o PNG), color principal (elegido o extraído del logo), nombre visible, servicios (nombre, duración, precio opcional), horario de apertura e instructores.
- La tipografía, los neutros, los radios y el movimiento NO se personalizan: garantizan calidad y accesibilidad con cualquier marca.
- Los logos de `assets/Logos` son ficticios y solo sirven para la demo.
