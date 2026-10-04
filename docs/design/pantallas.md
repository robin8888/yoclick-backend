# Inventario de pantallas

Las 94 pantallas del prototipo (`prototipo-yoclick.html`), con la ruta propuesta en Expo Router y la fase. **MVP** = Fase 1 del documento de requisitos; **F2+** = después del piloto. Abre el prototipo y usa el índice del panel izquierdo para ver cada una.

| # | id prototipo | Perfil | Pantalla | Ruta propuesta | Fase | Qué hace |
|---|---|---|---|---|---|---|
| 1 | `jstart` | Cliente | Unirse · Encuentra tu centro | `/join` | MVP | App compartida de las tiendas: se abre con la marca neutra de la plataforma. Tres formas de unirse: QR, código o búsqueda. Un enlace de invitación salta directo a la confirmación. |
| 2 | `jqr` | Cliente | Unirse · Escanear QR | `/join/scan` | MVP | El centro tiene su QR en recepción o lo envía por WhatsApp o correo. En la demo, elige el centro que simula el escaneo. |
| 3 | `jcode` | Cliente | Unirse · Código del centro | `/join/code` | MVP | Código de 6 caracteres que da el gimnasio. Prueba NORTE7, FORJA2 o KINE24; cualquier otro muestra el error. |
| 4 | `jsearch` | Cliente | Unirse · Buscar centro | `/join/search` | MVP | Búsqueda por nombre o ciudad, ordenada por cercanía (con permiso de ubicación). |
| 5 | `jconfirm` | Cliente | Unirse · Confirmar centro | `/join/[centerId]` | MVP | Antes de unirse, el cliente comprueba que es su centro. Al confirmar, la app se transforma con su logo y su color. |
| 6 | `welcome` | Cliente | Bienvenida | `/(auth)/welcome` | MVP | Tras unirse, la app ya muestra el logo, el nombre y el color del gimnasio. |
| 7 | `login` | Cliente | Iniciar sesión | `/(auth)/login` | MVP | Accesos rápidos para probar cada perfil. Enlace al alta de un gimnasio nuevo. |
| 8 | `reg1` | Cliente | Registro · 1 de 2 | `/(auth)/register` | MVP | Datos personales y foto de perfil opcional (cámara o galería). |
| 9 | `reg2` | Cliente | Registro · 2 de 2 | `/(auth)/register/goals` | MVP | Tiempo entrenando y objetivos; definen el nivel inicial (Inicio, Base, Avanzado). |
| 10 | `home` | Cliente | Inicio | `/(client)/(tabs)/home` | MVP | Próxima cita, progreso semanal, accesos rápidos y campana con contador de avisos sin leer. |
| 11 | `book1` | Cliente | Agendar · Servicio | `/(client)/book` | MVP | Paso 1: servicio con duración y precio opcional. |
| 12 | `book2` | Cliente | Agendar · Instructor | `/(client)/book/staff` | MVP | Paso 2: instructor concreto o «Cualquiera disponible». |
| 13 | `book3` | Cliente | Agendar · Día y hora | `/(client)/book/slot` | MVP | Paso 3: horas ocupadas bloqueadas y tachadas (no solo por color). |
| 14 | `book4` | Cliente | Agendar · Confirmar | `/(client)/book/confirm` | MVP | Resumen antes de reservar. |
| 15 | `booked` | Cliente | Cita confirmada | `/(client)/book/done` | MVP | Confirmación animada. Respeta «reducir movimiento» del sistema. |
| 16 | `appts` | Cliente | Mis citas | `/(client)/(tabs)/bookings` | MVP | Próximas e historial. Reprogramar y cancelar con confirmación. |
| 17 | `training` | Cliente | Zona de entrenamiento | `/(client)/(tabs)/train` | F2+ | Rutinas asignadas por el instructor y biblioteca de vídeos y PDF filtrada por nivel y necesidad. |
| 18 | `media` | Cliente | Contenido | `/(client)/content/[id]` | F2+ | Reproductor de vídeo o visor de PDF. |
| 19 | `routine` | Cliente | Rutina asignada | `/(client)/plans/[id]` | F2+ | Ejercicios con series y repeticiones; marcar como hecho suma al progreso semanal. |
| 20 | `notifs` | Cliente | Avisos | `/(client)/notifications` | MVP | Cambios y cancelaciones hechos por el instructor o el centro. |
| 21 | `profile` | Cliente | Perfil | `/(client)/(tabs)/profile` | MVP | Foto de perfil (toca el círculo), datos, nivel, objetivos, Mis centros, tema y cerrar sesión. Con el perfil Instructor, la misma pantalla sirve para su foto. |
| 22 | `jcenters` | Cliente | Mis centros | `/(client)/centers` | MVP | Para quien entrena en más de un gimnasio: cambia de centro y la app cambia de marca. También se abre tocando el logo en Inicio. |
| 23 | `iagenda` | Instructor | Mi agenda | `/(staff)/(tabs)/agenda` | MVP | Agenda diaria en línea de tiempo. Tocar una cita para moverla, reasignarla o cancelarla. |
| 24 | `iedit` | Instructor | Editar cita | `/(staff)/appointments/[id]` | MVP | Al guardar se avisa al cliente con una notificación. |
| 25 | `iclients` | Instructor | Mis clientes | `/(staff)/(tabs)/clients` | MVP | Nivel, sesiones hechas y próxima cita de cada cliente. |
| 26 | `inotifs` | Instructor | Avisos | `/(staff)/(tabs)/notifications` | MVP | Reservas, cambios y cancelaciones. |
| 27 | `aagenda` | Administrador | Agenda del centro | `/(admin)/(tabs)/agenda` | MVP | Resumen del día y columnas por instructor. |
| 28 | `aclients` | Administrador | Clientes y grupos | `/(admin)/(tabs)/clients` | MVP | Listado de clientes y grupos de entrenamiento. |
| 29 | `acontent` | Administrador | Contenidos | `/(admin)/(tabs)/content` | F2+ | Subir vídeos y PDF y asignarlos por nivel, grupo o cliente. |
| 30 | `aroutines` | Administrador | Rutinas | `/(admin)/plans/new` | F2+ | Crear desde la biblioteca de ejercicios y asignar a cliente o grupo. |
| 31 | `abrand` | Administrador | Personalización de marca | `/(admin)/(tabs)/brand` | MVP | Logo, color (manual o extraído del logo), vista previa en vivo y comprobación de contraste AA. |
| 32 | `asvc` | Administrador | Servicios, horario y equipo | `/(admin)/services` | MVP | Lista de servicios reservables: toca uno para editarlo o crea uno nuevo. Los cambios se ven al momento en Agendar cita del cliente. |
| 33 | `asvcedit` | Administrador | Editar servicio | `/(admin)/services/[id]` | MVP | El mismo editor que en el alta. Guardar actualiza la reserva del cliente; ocultar lo retira sin borrar el historial. |
| 34 | `asubs` | Administrador | Mi suscripción | `/(admin)/subscription` | MVP | Plan, próximo cobro, uso, facturas y método de pago. |
| 35 | `aplans` | Administrador | Cambiar de plan | `/(admin)/subscription/plans` | MVP | Básico, Pro y Premium. Importes pendientes: [PRECIO]. |
| 36 | `amore` | Administrador | Más | `/(admin)/(tabs)/more` | MVP | Accesos a rutinas, marca, suscripción y cierre de sesión. |
| 37 | `o1` | Alta de centro | Alta · Datos y tipo de centro | `/(onboarding)/center` | MVP | Paso 1 de 5. Sirve para cualquier centro con clases o citas: gimnasios, academias de baile, artes marciales, escuelas de cocina o música, academias… El tipo adapta el vocabulario (profesor, alumno, clase), los niveles y las sugerencias. |
| 38 | `o2` | Alta de centro | Alta · Logo y marca | `/(onboarding)/brand` | MVP | Sube el logo y ve la app con su marca al instante. El color se extrae del logo. |
| 39 | `o3` | Alta de centro | Alta · Servicios y horario | `/(onboarding)/services` | MVP | Paso 3 de 5. Crea servicios desde cero, parte de una sugerencia o toca uno para editarlo. |
| 40 | `osvc` | Alta de centro | Alta · Crear o editar servicio | `/(onboarding)/services/[id]` | MVP | Nombre, duración, precio, individual o en grupo con aforo, quién lo imparte, horario libre o clases fijas, reglas de reserva y cancelación, y vista previa de cómo lo verá el cliente. |
| 41 | `o4` | Alta de centro | Alta · Instructores | `/(onboarding)/team` | MVP | Invitaciones por correo. |
| 42 | `o5` | Alta de centro | Alta · Plan y prueba | `/(onboarding)/plan` | MVP | Prueba gratuita de 14 días sin tarjeta. |
| 43 | `odone` | Alta de centro | Tu app está lista | `/(onboarding)/done` | MVP | Fin del alta: entra al panel del administrador con la nueva marca. |
| 44 | `sa` | Plataforma | Panel de plataforma (web 1440 px) | `yoclick-web: /platform` | MVP | Gimnasios clientes, estados de suscripción, MRR, altas y bajas, uso por gimnasio y soporte. |
| 45 | `iprofile` | Instructor | Perfil del instructor | `/(staff)/(tabs)/profile` | MVP | Foto, datos, perfil profesional, disponibilidad y avisos. |
| 46 | `ashare` | Administrador | Invita a tus clientes | `/(admin)/invite` | MVP | QR para recepción, enlace para WhatsApp e Instagram y código del centro. También el botón de reservas para la web del centro. |
| 47 | `aposter` | Administrador | Cartel para recepción | `/(admin)/invite/poster` | MVP | Cartel imprimible con el QR y los pasos para unirse. |
| 48 | `acenter` | Administrador | Datos del centro y horario | `/(admin)/center` | MVP | Tipo de centro, contacto, datos fiscales, horario semanal editable, cierres y festivos, zona horaria. |
| 49 | `overify` | Alta de centro | Alta · Verifica tu correo | `/(onboarding)/verify-email` | MVP | El dueño crea su cuenta con contraseña y confirma el correo con un código de 6 dígitos. |
| 50 | `wallet` | Cliente | Mis bonos y pagos | `/(client)/wallet` | MVP | Saldo del bono o la cuota, recibos descargables y método de pago. |
| 51 | `shop` | Cliente | Comprar bono o cuota | `/(client)/wallet/shop` | MVP | Tarifas del centro: bonos, cuotas y matrícula. |
| 52 | `checkout` | Cliente | Pago | `/(client)/wallet/checkout` | MVP | Tarjeta guardada, Bizum, Apple Pay o Google Pay. Cupón de descuento. IVA incluido. |
| 53 | `paid` | Cliente | Pago completado | `/(client)/wallet/paid` | MVP | Recibo al momento y saldo actualizado. |
| 54 | `amoney` | Administrador | Tarifas y cobros | `/(admin)/money` | MVP | Tarifas (bonos, cuotas, matrícula), cobros del mes, recibos pendientes, remesa SEPA y cuenta de cobros. |
| 55 | `checkin` | Cliente | QR de acceso | `/(client)/access-pass` | MVP | Código personal para registrar la asistencia al llegar (o abrir el torno si el centro lo tiene). |
| 56 | `iclass` | Instructor | Clase en grupo · asistencia | `/(staff)/sessions/[id]` | MVP | Lista de asistentes con su bono o cuota, pasar lista (presente / falta), escanear el QR de acceso, lista de espera y mensaje al grupo. |
| 57 | `iscan` | Instructor | Escanear QR de asistencia | `/(staff)/scan` | MVP | Escáner siempre a mano desde Mi agenda: lee el QR de acceso del cliente, muestra su cita de hoy y su bono, y registra la asistencia. También avisa si no tiene reserva. |
| 58 | `acfile` | Administrador | Ficha de cliente | `/(admin)/clients/[id]` | MVP | Resumen (asistencia, bono, nivel editable, rutina), historial, notas privadas del equipo, pagos y acciones RGPD. |
| 59 | `agroup` | Administrador | Grupo | `/(admin)/groups/[id]` | MVP | Miembros,  |
| 60 | `icfile` | Instructor | Ficha de cliente | `/(staff)/clients/[id]` | MVP | La misma ficha, sin pagos: nivel, notas, historial y asignar rutina. |
| 61 | `irout` | Instructor | Crear rutina (instructor) | `/(staff)/plans/new` | F2+ | El instructor crea y asigna rutinas o prácticas desde su biblioteca. |
| 62 | `family` | Cliente | Mi familia | `/(client)/family` | MVP | Cuenta de tutor: añade a tus hijos, reserva por ellos y gestiona sus autorizaciones. |
| 63 | `kidadd` | Cliente | Añadir hijo o hija | `/(client)/family/new` | MVP | Datos del menor, consentimiento parental (obligatorio en menores de 14 años), autorización de imagen y personas autorizadas a recogerlo. |
| 64 | `forgot` | Cliente | Recuperar contraseña | `/(auth)/forgot-password` | MVP | Correo → código de 6 dígitos → nueva contraseña. |
| 65 | `pdata` | Cliente | Datos personales | `/settings/personal-data` | MVP | Nombre, contacto, fecha de nacimiento y contacto de emergencia. |
| 66 | `privacy` | Cliente | Privacidad y datos | `/settings/privacy` | MVP | Consentimientos que se pueden retirar, descargar mis datos (RGPD), salir de un centro y eliminar la cuenta. |
| 67 | `delacct` | Cliente | Eliminar mi cuenta | `/settings/delete-account` | MVP | Borrado dentro de la app (lo exige Apple). Explica qué se borra y qué se conserva por ley. |
| 68 | `asec` | Administrador | Seguridad de la cuenta | `/(admin)/security` | MVP | Verificación en dos pasos, sesiones abiertas y registro de actividad (quién vio o cambió qué). |
| 69 | `alegal` | Administrador | Privacidad y legal | `/(admin)/legal` | MVP | Contrato de encargado del tratamiento, política de privacidad del centro, consentimientos recogidos y solicitudes RGPD. |
| 70 | `help` | Cliente | Ayuda y contacto | `/settings/help` | MVP | Preguntas frecuentes, contacto con el centro y soporte de la app. |
| 71 | `iavail` | Instructor | Mi disponibilidad | `/(staff)/availability` | MVP | Horario semanal propio y ausencias (vacaciones, formación). Solo se puede reservar contigo en esas franjas. |
| 72 | `ateam` | Administrador | Equipo y permisos | `/(admin)/team` | MVP | Roles (administración, recepción, instructor), qué puede ver cada uno, invitaciones y disponibilidad del equipo. |
| 73 | `chats` | Cliente | Mensajes | `/(client)/messages` | F2+ | Conversaciones con tu instructor o profesor y con recepción. |
| 74 | `chat` | Cliente | Chat | `/(client)/messages/[threadId]` | F2+ | Mensajes con respuesta del equipo; adjuntar foto o documento. |
| 75 | `prefs` | Cliente | Preferencias de avisos | `/settings/notifications` | MVP | Canal por tipo de aviso (push, correo, WhatsApp, SMS), antelación del recordatorio y horas de silencio. |
| 76 | `refer` | Cliente | Trae a un amigo | `/(client)/refer` | F2+ | Código personal para invitar y recompensa para los dos. |
| 77 | `ichat` | Instructor | Chat con un cliente | `/(staff)/messages/[threadId]` | F2+ | El instructor responde desde la ficha o desde el aviso. |
| 78 | `achat` | Administrador | Chat de recepción | `/(admin)/messages/[threadId]` | F2+ | El centro escribe a un cliente desde su ficha. |
| 79 | `acamp` | Administrador | Campañas y cupones | `/(admin)/campaigns` | F2+ | Mensajes a segmentos (inactivos, bono por caducar, nuevos), cupones de descuento y programa «trae a un amigo». |
| 80 | `areports` | Administrador | Informes | `/(admin)/reports` | F2+ | Ingresos, ocupación por servicio, retención, inactivos y horas por instructor, con exportación CSV. |
| 81 | `pubweb` | Web pública | Web de reservas del centro | `yoclick-web: /c/[centerSlug]` | MVP | Página pública con la marca del centro: servicios, horarios, tarifas y reserva sin descargar la app. Se enlaza desde Instagram, Google o la web del centro. |
| 82 | `aimport` | Administrador | Importar clientes | `/(admin)/clients/import` | MVP | Desde Excel o CSV de otro programa: detecta columnas, avisa de duplicados, importa saldos de bonos e invita a la app. |
| 83 | `iprof` | Instructor | Mi perfil profesional | `/(staff)/public-profile` | F2+ | El instructor sube su vídeo de presentación y vídeos mostrando su técnica, su biografía, especialidades y titulaciones. Lo revisa el centro antes de publicarlo. |
| 84 | `team` | Cliente | Nuestro equipo | `/(client)/team` | F2+ | Los clientes conocen a los instructores antes de reservar: vídeo, valoración y especialidades. |
| 85 | `tprof` | Cliente | Perfil del instructor | `/(client)/team/[staffId]` | F2+ | Vídeo de presentación, vídeos de técnica, biografía, titulaciones, opiniones verificadas y «Reservar con…». |
| 86 | `aprofiles` | Administrador | Perfiles del equipo | `/(admin)/team/profiles` | F2+ | El centro revisa y aprueba los vídeos y perfiles antes de que los vean los clientes. |
| 87 | `atrial` | Administrador | Fin de la prueba | `/(admin)/subscription/trial` | MVP | Días restantes, qué pasa al terminar y añadir el método de pago (tarjeta o SEPA). |
| 88 | `acancel` | Administrador | Cancelar suscripción | `/(admin)/subscription/cancel` | MVP | Motivo, alternativas (pausar, bajar de plan), exportar datos y fecha efectiva. |
| 89 | `stload` | Transversal | Cargando | `componente <ScreenSkeleton>` | MVP | Esqueletos de carga en lugar de pantallas en blanco; aparecen si la carga dura más de 300 ms. |
| 90 | `stempty` | Transversal | Vacíos | `componente <EmptyState>` | MVP | Qué ver cuando no hay datos, siempre con la siguiente acción. |
| 91 | `sterr` | Transversal | Errores | `componente <ErrorState>` | MVP | Pago rechazado y fallo del servidor: mensaje claro, sin culpar, con reintento. |
| 92 | `stoff` | Transversal | Sin conexión | `componente <OfflineBanner>` | MVP | Se ve lo último guardado; las acciones quedan en cola y se envían al volver la conexión. |
| 93 | `stupd` | Transversal | Actualización | `componente <ForceUpdateGate>` | MVP | Actualización obligatoria cuando hay un cambio de seguridad. |
| 94 | `lang` | Cliente | Idioma | `/settings/language` | F2+ | Castellano, catalán, euskera, gallego, inglés y portugués. Cada persona elige el suyo; el centro solo configura el idioma por defecto. |
