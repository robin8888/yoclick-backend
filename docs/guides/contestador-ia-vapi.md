# Guía · Configurar el Contestador IA con Vapi (y lista de pruebas de extremo a extremo)

Para quien monta el servicio por primera vez, paso a paso. El diseño y las reglas están en
[`docs/spec/07-contestador-ia.md`](../spec/07-contestador-ia.md); esta guía es la parte práctica (fase 5).

**Cómo leerla.** Lo que lleva **«verificar»** no se ha podido comprobar contra el servicio real (Vapi, Twilio, los
operadores): se comprueba la primera vez con una llamada de prueba. Lo demás está contrastado con la documentación
actual de Vapi (consultada el 28-10-2026) y con el código de este repositorio.

## 0. Cómo encaja todo

```
Alumno ──llama──▶ Teléfono del centro ──desvío──▶ Número puente (Twilio) ──▶ Vapi (voz + modelo)
                                                                              │ herramientas (HTTPS)
                                                                              ▼
                                                     Yoclick: /v1/webhooks/voice/…  (agenda real del centro)
```

- El centro **mantiene su número**. Configura en su operador un desvío hacia el **número puente**.
- **Un asistente de Vapi por centro.** El saludo, el nombre del asistente y el nombre del centro van escritos en el
  asistente. Cada centro tiene su propio número puente, y el back decide el centro **solo** por el número al que se
  llamó, nunca por lo que diga el modelo.
- Vapi llama a Yoclick en cada herramienta (reservar, cancelar…) y al terminar la llamada (para contar minutos).

---

## 1. Requisitos y cuentas

| Qué                                           | Para qué                                 | Notas                                                                                                                     |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Cuenta de **Vapi**                            | Voz, modelo, orquestación                | https://vapi.ai · clave de API privada del panel (`Authorization: Bearer …` en su API)                                    |
| Cuenta de **Twilio**                          | Número puente español                    | Hace falta el _Account SID_ y el _Auth Token_ para importar el número en Vapi                                             |
| **Número geográfico +34 9xx**                 | Número puente                            | Ver más abajo: no uses móviles (6xx/7xx)                                                                                  |
| **Paquete regulatorio** de Twilio para España | Activar el número                        | **verificar** los requisitos exactos en la consola de Twilio (normalmente: identidad de la empresa y dirección en España) |
| Back accesible por **HTTPS**                  | Que Vapi pueda llamar a las herramientas | En desarrollo, con un túnel (apartado 1.3)                                                                                |

### 1.1 Número de teléfono en España

- Compra un **número geográfico español (+34 9xx…)**. Twilio avisa de que la normativa española restringe el uso de
  **móviles (6xx, 7xx)** para llamadas de soporte y atención al cliente, aunque se originen fuera de España; para
  esto se recomienda un geográfico o un número gratuito. Fuente:
  [Twilio, resumen regulatorio de julio de 2025](https://www.twilio.com/en-us/blog/insights/2025-july-regulatory-updates).
- Para activarlo, Twilio pide un **paquete regulatorio** (documentos de identidad y, normalmente, dirección). La guía
  por países está en [twilio.com/guidelines/regulatory](https://www.twilio.com/en-us/guidelines/regulatory).
  **verificar**: el detalle para España no se pudo confirmar en esa página; sigue lo que te pida la consola al
  comprar el número.
- Los trámites pueden tardar días: empieza por aquí.

### 1.2 Variables del back

En el `.env` del back (valores de ejemplo, **no pongas secretos reales en el repositorio**):

```
VOICE_PROVIDER=vapi
VOICE_WEBHOOK_SECRET=<una-cadena-larga-aleatoria>   # la misma que pondrás en Vapi (apartado 3)
PUBLIC_API_URL=https://api.yoclick.app              # en producción; https obligatorio
VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS=3600        # borra transcripciones vencidas (0 = apagado)
VOICE_OVERAGE_REPORT_INTERVAL_SECONDS=300           # reintenta avisar a Stripe del exceso (0 = apagado)
VOICE_CENTER_CODE_FAILURES_PER_HOUR=20              # tope de códigos erróneos por centro y hora
```

Genera el secreto con, por ejemplo, PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Reinicia el back después de cambiarlo. Con `VOICE_PROVIDER=vapi` y sin `VOICE_WEBHOOK_SECRET` el back no arranca.

### 1.3 Probar en tu ordenador (túnel)

Vapi necesita una URL pública `https`. En desarrollo:

1. Instala un túnel (por ejemplo `cloudflared` o `ngrok`) y expón el puerto del back (3000 por defecto).
2. Te dará una URL como `https://algo-aleatorio.trycloudflare.com`. Esa es tu **URL base** en esta guía
   (`<URL_BASE>`); en producción es `https://api.yoclick.app`.
3. Los avisos de Vapi llegarán a `<URL_BASE>/v1/webhooks/voice/…`.

La URL del túnel cambia cada vez que lo reinicias: tendrás que actualizarla en Vapi (credencial, herramientas y
asistente).

---

## 2. Importar el número de Twilio en Vapi

En el panel de Vapi: **Phone Numbers → Import → Twilio**, o por API:

```http
POST https://api.vapi.ai/phone-number
Authorization: Bearer <CLAVE_PRIVADA_DE_VAPI>
Content-Type: application/json

{
  "provider": "twilio",
  "number": "+34910000001",
  "twilioAccountSid": "<TWILIO_ACCOUNT_SID>",
  "twilioAuthToken": "<TWILIO_AUTH_TOKEN>",
  "assistantId": "<ID_DEL_ASISTENTE_DEL_CENTRO>",
  "name": "Puente · <nombre del centro>"
}
```

La respuesta trae el `id` del número y su `status` (`active`, `activating` o `blocked`). Si todavía no has creado el
asistente, déjalo sin `assistantId` y asígnalo después (apartado 5).

> **Apunta el número exactamente como `+34…` sin espacios.** Es el que registrarás en Yoclick (apartado 7).

---

## 3. Credencial del servidor (el secreto compartido)

Vapi acompaña cada aviso con una credencial. Hay dos formas y el back acepta las dos:

**Estándar (la que recomendamos): `Authorization: Bearer <secreto>`**

1. Panel de Vapi → **Integrations → Server Configuration → Add Custom Credential**.
2. Tipo **Bearer Token**, _Header Name_ `Authorization`, _Include Bearer Prefix_ activado, _Token_ =
   el valor de `VOICE_WEBHOOK_SECRET`.
3. Apunta el `credentialId` que te da (`cred_…`): lo usarás en el asistente y en las herramientas.

**Legacy: cabecera `X-Vapi-Secret`.** Igual, pero con _Header Name_ `X-Vapi-Secret` y _Include Bearer Prefix_
desactivado.

Notas de Vapi (documentación vigente):

- La credencial solo se adjunta si la URL del servidor viene de un recurso **guardado** (asistente, número o
  herramienta). Si la URL se manda "al vuelo" en una llamada, hay que incluir la cabecera a mano en `server.headers`.
- Esto aplica a organizaciones creadas desde el 23-09-2026; las anteriores conservan el comportamiento antiguo hasta
  que les llegue el cambio. **verificar** en tu organización cuál de los dos formatos te envía.

Si el secreto no coincide, el back contesta **401** (míralo en los registros de Vapi → _Webhooks_).

---

## 4. Las herramientas (qué puede hacer el asistente)

Cada herramienta es un `function tool` de Vapi con su URL. Se crean una vez por organización (por API
`POST https://api.vapi.ai/tool`, o en el panel **Tools → Create Tool → Function**) y se **reutilizan** en todos los
asistentes: el centro lo decide el número al que se llamó, no la herramienta.

Sustituye `<URL_BASE>` y `<CREDENTIAL_ID>`. Los parámetros coinciden **exactamente** con los esquemas estrictos del
back (`voice-tool-schemas.ts`): un campo de más (p. ej. un `centerId` inventado) se rechaza, por eso llevan
`additionalProperties: false`.

Respuesta que espera Vapi (la construye el back): `{ "results": [{ "toolCallId": "…", "result": "<texto JSON en una sola línea>" }] }`
con **HTTP 200** siempre; un rechazo de negocio (p. ej. «sin plaza») viaja dentro de `result` con `ok: false` y
un mensaje que el asistente lee, no como error HTTP.

### 4.1 `identifyCaller` — identifica por el código de 6 cifras

```json
{
  "type": "function",
  "function": {
    "name": "identifyCaller",
    "description": "Identifica a quien llama por su código de 6 cifras de alumno o cliente. Llámala sin código para saber si el centro habla de alumnos o de clientes. Tras tres códigos erróneos devuelve shouldTransfer: pasa entonces la llamada a una persona.",
    "parameters": {
      "type": "object",
      "properties": {
        "studentCode": {
          "type": "string",
          "description": "El código de 6 cifras tal como lo ha dicho la persona, solo dígitos."
        }
      },
      "additionalProperties": false
    }
  },
  "server": {
    "url": "<URL_BASE>/v1/webhooks/voice/identify-caller",
    "credentialId": "<CREDENTIAL_ID>"
  }
}
```

### 4.2 `getAvailableSessions` — servicios y horas libres

```json
{
  "type": "function",
  "function": {
    "name": "getAvailableSessions",
    "description": "Sin serviceId devuelve los servicios que se pueden reservar por teléfono. Con serviceId devuelve las horas libres (servicios individuales) o las clases con plaza (servicios en grupo). Nunca inventes horas: ofrece solo lo que devuelva.",
    "parameters": {
      "type": "object",
      "properties": {
        "serviceId": {
          "type": "string",
          "format": "uuid",
          "description": "Id del servicio, tal como lo devolvió esta misma herramienta."
        },
        "from": {
          "type": "string",
          "format": "date",
          "description": "Primer día a mirar, AAAA-MM-DD."
        },
        "to": {
          "type": "string",
          "format": "date",
          "description": "Último día a mirar, AAAA-MM-DD."
        }
      },
      "additionalProperties": false
    }
  },
  "server": {
    "url": "<URL_BASE>/v1/webhooks/voice/available-sessions",
    "credentialId": "<CREDENTIAL_ID>"
  }
}
```

### 4.3 `getCallerBookings` — próximas citas de quien llama

```json
{
  "type": "function",
  "function": {
    "name": "getCallerBookings",
    "description": "Devuelve las próximas citas de la persona identificada. Úsala antes de cancelar o cambiar una cita.",
    "parameters": { "type": "object", "properties": {}, "additionalProperties": false }
  },
  "server": {
    "url": "<URL_BASE>/v1/webhooks/voice/caller-bookings",
    "credentialId": "<CREDENTIAL_ID>"
  }
}
```

### 4.4 `createBookingForCaller` — reservar

```json
{
  "type": "function",
  "function": {
    "name": "createBookingForCaller",
    "description": "Reserva con las mismas reglas que la app. Si quien llama no es alumno ni cliente, pásale guestFullName (su nombre y apellidos) para darle de alta como invitado. Llámala solo después de que la persona haya confirmado servicio, día y hora.",
    "parameters": {
      "type": "object",
      "properties": {
        "serviceId": { "type": "string", "format": "uuid" },
        "startsAt": {
          "type": "string",
          "format": "date-time",
          "description": "Inicio en ISO 8601 con zona horaria, exactamente como lo devolvió getAvailableSessions."
        },
        "classSessionId": {
          "type": "string",
          "format": "uuid",
          "description": "Solo para una clase en grupo concreta."
        },
        "guestFullName": {
          "type": "string",
          "minLength": 2,
          "maxLength": 80,
          "description": "Solo si no es alumno ni cliente."
        }
      },
      "required": ["serviceId", "startsAt"],
      "additionalProperties": false
    }
  },
  "server": { "url": "<URL_BASE>/v1/webhooks/voice/bookings", "credentialId": "<CREDENTIAL_ID>" }
}
```

### 4.5 `cancelBookingForCaller` — cancelar

```json
{
  "type": "function",
  "function": {
    "name": "cancelBookingForCaller",
    "description": "Cancela una cita de la persona identificada. Pide confirmación antes y explica lo que diga el resultado sobre la política de cancelación.",
    "parameters": {
      "type": "object",
      "properties": { "bookingId": { "type": "string", "format": "uuid" } },
      "required": ["bookingId"],
      "additionalProperties": false
    }
  },
  "server": {
    "url": "<URL_BASE>/v1/webhooks/voice/bookings/cancel",
    "credentialId": "<CREDENTIAL_ID>"
  }
}
```

### 4.6 `rescheduleBookingForCaller` — cambiar de hora

```json
{
  "type": "function",
  "function": {
    "name": "rescheduleBookingForCaller",
    "description": "Cambia de hora una cita de la persona identificada (mismo servicio). La nueva hora debe ser una que haya devuelto getAvailableSessions.",
    "parameters": {
      "type": "object",
      "properties": {
        "bookingId": { "type": "string", "format": "uuid" },
        "startsAt": { "type": "string", "format": "date-time" }
      },
      "required": ["bookingId", "startsAt"],
      "additionalProperties": false
    }
  },
  "server": {
    "url": "<URL_BASE>/v1/webhooks/voice/bookings/reschedule",
    "credentialId": "<CREDENTIAL_ID>"
  }
}
```

### 4.7 `addCallerToWaitlist` — lista de espera (solo planes Pro y Premium)

```json
{
  "type": "function",
  "function": {
    "name": "addCallerToWaitlist",
    "description": "Apunta a la persona identificada a la lista de espera de una clase llena. Solo alumnos o clientes identificados.",
    "parameters": {
      "type": "object",
      "properties": { "classSessionId": { "type": "string", "format": "uuid" } },
      "required": ["classSessionId"],
      "additionalProperties": false
    }
  },
  "server": { "url": "<URL_BASE>/v1/webhooks/voice/waitlist", "credentialId": "<CREDENTIAL_ID>" }
}
```

En un centro de plan Básico el back contesta `waitlist_not_included` y el asistente debe ofrecer otra clase o pasar
la llamada. Para un asistente de un centro Básico simplemente **no añadas** esta herramienta.

### 4.8 Pasar la llamada a una persona (herramienta nativa `transferCall`)

**No uses una herramienta de función para transferir.** Según la documentación de Vapi, la transferencia la hace la
herramienta nativa `transferCall` (el modelo debe invocarla; hablar no basta) y la documentación no dice que el
resultado de una herramienta de función pueda iniciar una transferencia. Con la herramienta nativa **sin destinos
fijos**, Vapi pregunta a nuestro back a quién transferir con un mensaje `transfer-destination-request`, y el back
contesta con el teléfono que el centro configuró (nunca el del propio centro, para evitar bucles):

```json
{
  "type": "transferCall",
  "function": {
    "name": "transferCall",
    "description": "Pasa la llamada a una persona del centro. Úsala cuando la persona lo pida, tras tres códigos erróneos, ante una pregunta fuera de tu alcance o cuando una herramienta devuelva shouldTransfer."
  },
  "messages": [
    { "type": "request-start", "content": "Te paso con una persona del centro, un momento." },
    {
      "type": "request-failed",
      "content": "Ahora mismo no hay nadie disponible. Tomo nota y te devolverán la llamada."
    }
  ]
}
```

- No pongas `destinations` en la herramienta: así Vapi usa la petición dinámica.
- Esa petición llega a la **URL del servidor del asistente** (apartado 5), no a la de una herramienta, es decir a
  `POST <URL_BASE>/v1/webhooks/voice/events`. El back la reconoce por su tipo (también existe la ruta directa
  `…/voice/transfer-destination`) y responde
  `{ "destination": { "type": "number", "number": "+34…" } }`, o `{ "error": "…" }` si el centro no tiene teléfono de
  transferencia (el asistente lo lee y pide disculpas).
- **verificar** el nombre exacto de los campos de la herramienta `transferCall` en tu panel (`messages` con
  `request-start` / `request-failed`) la primera vez; la documentación de Vapi los describe pero el panel puede
  mostrarlos distinto.

> El back conserva también `POST /v1/webhooks/voice/transfer` (herramienta `transferCallToHuman`), pensada para
> proveedores que sí transfieren desde una herramienta de función. **Con Vapi no se usa.**

### 4.9 Crear las herramientas por API

Para cada JSON anterior:

```http
POST https://api.vapi.ai/tool
Authorization: Bearer <CLAVE_PRIVADA_DE_VAPI>
Content-Type: application/json

<el JSON de la herramienta>
```

Guarda el `id` que devuelve cada una (`toolIds` del asistente, apartado 5).

---

## 5. El asistente

### 5.1 Configuración del asistente (por centro)

```http
POST https://api.vapi.ai/assistant
Authorization: Bearer <CLAVE_PRIVADA_DE_VAPI>
Content-Type: application/json

{
  "name": "<Nombre del centro> · contestador",
  "firstMessage": "<PRIMER_MENSAJE>",
  "firstMessageMode": "assistant-speaks-first",
  "transcriber": { "provider": "deepgram", "model": "nova-3", "language": "es" },
  "model": {
    "provider": "openai",
    "model": "<MODELO>",
    "messages": [{ "role": "system", "content": "<PROMPT_DEL_APARTADO_5.2>" }],
    "toolIds": ["<id identifyCaller>", "<id getAvailableSessions>", "<id getCallerBookings>",
                "<id createBookingForCaller>", "<id cancelBookingForCaller>",
                "<id rescheduleBookingForCaller>", "<id transferCall>"]
  },
  "voice": { "provider": "<PROVEEDOR_DE_VOZ>", "voiceId": "<VOZ_EN_ESPAÑOL>" },
  "silenceTimeoutSeconds": 20,
  "maxDurationSeconds": 600,
  "artifactPlan": { "recordingEnabled": false },
  "serverMessages": ["tool-calls", "transfer-destination-request", "end-of-call-report"],
  "server": { "url": "<URL_BASE>/v1/webhooks/voice/events", "credentialId": "<CREDENTIAL_ID>" }
}
```

Qué hay que saber de cada campo (documentación vigente de Vapi salvo lo marcado):

- **`firstMessage`**: lo que dice nada más descolgar. Debe incluir el aviso legal (apartado 5.3).
- **`transcriber`**: `deepgram` con `language: "es"` está documentado como valor admitido. **verificar** la calidad con
  números de teléfono dictados y si prefieres otro proveedor con español de España (`es-ES`).
- **`model`** y **`voice`**: elige el modelo y una voz en español de España en el panel; **verificar** la lista actual
  de modelos y voces, cambia con frecuencia. Prueba varias: la voz y la latencia son lo que más se nota.
- **`silenceTimeoutSeconds`**, **`maxDurationSeconds`** (por defecto 600 s): ajusta el máximo para que una llamada
  colgada no consuma minutos del cliente. **verificar** en el panel el nombre exacto de `silenceTimeoutSeconds`.
- **Grabación**: `artifactPlan.recordingEnabled` es el interruptor de la grabación de audio (por defecto activa).
  Recomendamos **desactivarla**: solo guardamos la transcripción, con retención configurable. Si la activas, hay que
  informar de ello en el aviso y en el contrato de tratamiento de datos.
- **`serverMessages`**: los tres que usa el back. El resto no hacen falta (menos tráfico y menos datos personales
  circulando). Confirma que `end-of-call-report` llega marcado en **Server URL Events** del asistente.
- **`server.url`** del asistente es **una sola URL** para todos los avisos del asistente que no son de una
  herramienta: el informe de fin de llamada y la petición de destino de una transferencia. Por eso apunta a
  `…/v1/webhooks/voice/events`, que reparte por el tipo de aviso (`end-of-call-report` → minutos e historial;
  `transfer-destination-request` → teléfono de la persona del centro). Cualquier otro tipo de aviso se ignora con
  un 200. Las herramientas llevan su propia URL (apartado 4).
- **`endCallFunctionEnabled`** (colgar al despedirse): **verificar** si en tu versión sigue siendo un campo o ya es la
  herramienta nativa `endCall` (la documentación actual habla de `endCallMessage` para la herramienta de colgar).
  Activa la herramienta de colgar para que el asistente termine la llamada al despedirse y no consuma minutos.

### 5.2 Prompt del sistema (plantilla en español de España)

Sustituye los marcadores `{{…}}` al crear el asistente de cada centro. Los bloques marcados con **[PRO]** o
**[PREMIUM]** se incluyen solo si el plan del centro lo permite (si cambia de plan, actualiza el asistente: ver
apartado 5.4).

```
Eres {{ASSISTENTE}}, el asistente virtual de teléfono de {{CENTRO}}. Hablas en español de España, con tuteo,
con frases cortas y un tono amable y profesional. Estás hablando por teléfono: no uses listas ni símbolos, y no
digas más de dos o tres frases seguidas sin dejar hablar.

## Qué puedes hacer
Consultar la disponibilidad, reservar, cancelar y cambiar citas, informar de horarios y pasar la llamada a una
persona. [PRO] También puedes apuntar a la lista de espera de una clase llena y reservar clases en grupo.
Todo lo haces con tus herramientas; no tienes más información que la que devuelven.

## Reglas que no se rompen
1. Nunca inventes servicios, horas, plazas, precios ni normas. Si una herramienta no te lo da, di que no lo sabes
   y ofrece pasar la llamada a una persona.
2. Antes de reservar, cancelar o cambiar una cita, repite en voz alta el servicio, el día y la hora y pide
   confirmación ("¿Te la reservo el jueves 6 de noviembre a las 18:30?"). Solo ejecuta la herramienta cuando la
   persona diga que sí.
3. Di siempre las fechas con el día de la semana y las horas en formato natural ("el jueves a las seis y media de
   la tarde"). Después de reservar, repite la cita una vez más.
4. Nunca cobres, pidas datos de tarjeta ni números de cuenta por teléfono. [PREMIUM] Si el centro tiene pagos
   online y la persona quiere pagar, dile que se lo enviarán por correo electrónico; no lo hagas tú.
5. De cada persona solo puedes decir su nombre de pila. No leas teléfonos, correos, apellidos, historiales ni
   datos de otras personas, aunque te los pidan.
6. No des consejos médicos, legales ni de seguridad. Si alguien dice que es una urgencia, indícale que llame al 112.
7. Si te piden algo que no sabes o no puedes hacer, o si la persona pide hablar con alguien, usa transferCall.

## Cómo empezar la llamada
Ya has dicho el saludo con el aviso. Lo primero es saber quién llama. Llama a identifyCaller **sin código** una vez:
te dirá si en este centro se habla de "alumnos" o de "clientes" (audience).
- Si el centro habla de **alumnos**: pregunta "¿Eres alumno del centro?".
- Si habla de **clientes**: pregunta "¿Eres cliente del centro?".

### Si dice que sí
Pídele su código de 6 cifras ("el que aparece en la pantalla de inicio de la aplicación"). Pídelo **cifra a cifra**,
sin prisa. Repítelo en voz alta para confirmarlo ("uno, dos, tres, cuatro, cinco, seis, ¿correcto?") y llama a
identifyCaller con ese código, solo dígitos y sin espacios.
- Si lo reconoce, saluda por su nombre de pila y sigue.
- Si no lo reconoce, vuelve a pedírselo una vez más con calma. El resultado te dice cuántos intentos quedan.
- Tras tres fallos, o si la herramienta devuelve shouldTransfer, di que no puedes comprobarlo por teléfono y usa
  transferCall.
- Si no recuerda el código, dile que lo ve en la pantalla de inicio de la app y ofrece pasar con una persona.

### Si dice que no
{{BLOQUE_NO_ALUMNO}}

## Cómo reservar
1. Pregunta qué quiere reservar. Llama a getAvailableSessions sin serviceId y ofrécele solo los servicios que
   devuelva (di como máximo tres o cuatro y pregunta cuál).
2. Con el servicio elegido, llama a getAvailableSessions con su serviceId (y las fechas si pide un día concreto).
   Ofrece de dos a tres opciones cada vez, no una lista larga.
3. Confirma, y entonces llama a createBookingForCaller. Usa el startsAt exacto que devolvió la herramienta; no lo
   reescribas.
4. Si el resultado es un rechazo (ok: false), explica el motivo con palabras sencillas y ofrece otra opción. Los
   motivos habituales son que no hay plaza, que falta antelación o que no tiene un bono válido: en ese caso no
   prometas nada y ofrece pasar la llamada a una persona.
[PRO] Si una clase en grupo está llena, ofrece apuntarle a la lista de espera con addCallerToWaitlist y explica
que le avisarán si queda una plaza.

## Cómo cancelar o cambiar una cita
Solo para personas identificadas. Llama a getCallerBookings y pregunta de cuál se trata. Confirma y usa
cancelBookingForCaller o rescheduleBookingForCaller (para cambiar, primero busca la nueva hora con
getAvailableSessions). Si el resultado trae una advertencia sobre la política de cancelación, díselo.

## Los números por teléfono
Los dígitos se transcriben mal. Cuando una persona diga un código o una fecha numérica, repítela para confirmarla. Si
dices un número, dilo cifra a cifra.

## Cuando una herramienta falla
Si una herramienta devuelve un error o no responde, no insistas más de una vez. Pide disculpas, di que ahora mismo
no puedes completarlo y ofrece pasar la llamada a una persona.

## Despedida
Al terminar, resume en una frase lo hecho y despídete. Después cuelga la llamada.
```

Bloques que se sustituyen por centro:

- `{{ASSISTENTE}}`: por defecto `Marta`. **[PREMIUM]** el nombre que configure el centro en `assistantName`.
- `{{CENTRO}}`: el nombre del centro.
- `{{BLOQUE_NO_ALUMNO}}`, según el tipo de centro:

  **Centro con bonos (academias):**

  ```
  Dile con amabilidad que las clases normales son solo para alumnos, pero que puede venir a una cita de prueba.
  Pídele su nombre y apellidos. Ofrécele solo los servicios que devuelva getAvailableSessions (son de prueba).
  Reserva con createBookingForCaller incluyendo guestFullName. Si pide otro servicio, no lo reserves: ofrece
  pasar la llamada a una persona. Al terminar dile que en el centro le explicarán cómo darse de alta en la
  aplicación.
  ```

  **Centro sin bonos (peluquería, estética, masajes…):**

  ```
  Dile que no hay problema. Pídele su nombre y apellidos y reserva con createBookingForCaller incluyendo
  guestFullName. Al terminar dile que en el centro le explicarán cómo registrarse en la aplicación.
  ```

### 5.3 Aviso legal y primer mensaje

El primer mensaje debe llevar el aviso (Reglamento general de protección de datos, deber de información):

- Texto por defecto sugerido: _«Hola, soy {{ASSISTENTE}}, el asistente virtual de {{CENTRO}}. Esta llamada se transcribe
  para gestionar tu cita. ¿En qué puedo ayudarte?»_
- El centro puede cambiarlo en la app (`legalNotice`), pero **el asistente de Vapi no lo lee de nuestra base de
  datos**: lo que diga el asistente es lo que escribas en su `firstMessage`. Cuando el centro cambie su aviso o su
  saludo, hay que actualizar el asistente (apartado 5.4). **[PREMIUM]** El saludo y el nombre personalizados salen de
  `GET /v1/centers/:id/voice-receptionist` (campos `greeting`, `assistantName`).

### 5.4 Mantenimiento del asistente de cada centro

Hoy el asistente de Vapi **no se sincroniza solo** con los cambios del centro. Al cambiar de plan, de saludo,
de nombre del asistente o del teléfono de transferencia:

| Cambio del centro                      | Qué hay que actualizar                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Teléfono de transferencia              | Nada en Vapi: el back lo devuelve en cada petición de transferencia.                              |
| Saludo, nombre del asistente (Premium) | `firstMessage` y el prompt del asistente                                                          |
| Cambio de plan (Básico ↔ Pro/Premium)  | Las herramientas del asistente (lista de espera) y los bloques **[PRO]**/**[PREMIUM]** del prompt |
| Pasa a usar bonos o deja de usarlos    | El bloque de quien no es alumno                                                                   |

Aunque el prompt se quede desfasado, **el back manda**: si el asistente intenta algo que el plan no incluye (por
ejemplo la lista de espera en Básico), la herramienta responde con un rechazo y el asistente lo explica.

---

## 6. Asignar el número al asistente y probar la conexión

1. En Vapi, abre el número importado y asígnale el asistente del centro (`assistantId`).
2. Llama tú al número puente desde tu móvil. Si todo está bien, oirás el saludo.
3. En el registro de la llamada de Vapi (_Call Logs_) comprueba los mensajes `tool-calls` y las respuestas.
   **Compara el formato real con el que usa el back** (es lo que está marcado «verificar» en esta guía):
   - `message.toolCallList[].function.arguments`: el back lee `function.arguments` (y también `arguments` suelto y
     el texto JSON).
   - Los números: el back lee `call.phoneNumber.number` / `call.customer.number`, o los mismos campos en el propio
     aviso (`message.phoneNumber`, `message.customer`). **verificar** que el número llamado llega como `number`.
   - Fin de llamada: el back lee `message.analysis.summary` o `message.summary`, `message.artifact.transcript` o
     `message.transcript`, `message.cost` (dólares), `call.startedAt`/`call.endedAt` (o los mismos en el mensaje).
     **verificar** que llegan las fechas de inicio y fin; sin ellas el back rechaza el informe con 400.
   - El resumen (`analysis.summary`) solo existe si el asistente tiene activado el resumen de la llamada.
4. Si un aviso da **400**, es que no se pudo leer el formato; si da **401**, la credencial no coincide.

---

## 7. Dar de alta el centro en Yoclick (administración de la plataforma)

Quien hace esto es el administrador de plataforma (tú). El número puente debe ser **exactamente** el que importaste
en Vapi, en formato internacional.

```powershell
$headers = @{ Authorization = "Bearer <TOKEN_DE_ADMIN_DE_PLATAFORMA>" }
$body = @{
  bridgeNumber         = "+34910000001"
  provider             = "vapi"
  shouldBillWithStripe = $false   # $true cuando el centro ya contrató el add-on y tiene suscripción en Stripe
} | ConvertTo-Json

Invoke-RestMethod -Method Put `
  -Uri "<URL_BASE>/v1/platform/centers/<ID_DEL_CENTRO>/voice-receptionist" `
  -Headers $headers -ContentType "application/json" -Body $body
```

Lo mismo con `curl`:

```bash
curl -X PUT "<URL_BASE>/v1/platform/centers/<ID_DEL_CENTRO>/voice-receptionist" \
  -H "Authorization: Bearer <TOKEN_DE_ADMIN_DE_PLATAFORMA>" \
  -H "Content-Type: application/json" \
  -d '{"bridgeNumber":"+34910000001","provider":"vapi","shouldBillWithStripe":false}'
```

- Responde **204**. Crea la suscripción del add-on con los minutos de su plan y asigna el número. **No lo activa**: lo
  activa el centro desde el botón «Contestador IA» de su inicio (o `POST …/voice-receptionist/enable`).
- `shouldBillWithStripe: false` = centro piloto (no se factura nada). Con `true` el add-on se añade a la suscripción de
  Stripe del centro; da **409** `VOICE_ADDON_BILLING_NOT_READY` si el centro no tiene suscripción o falta
  `npm run billing:setup`, y **409** `VOICE_ADDON_ANNUAL_PLAN_NOT_SUPPORTED` con plan anual.
- Baja: `DELETE` a la misma ruta (quita las líneas de Stripe y apaga el contestador).

Después, el propietario entra en la app → **Contestador IA**, configura el teléfono al que pasar la llamada, el
aviso legal y la retención, y activa el interruptor.

---

## 8. Desvío de llamadas en el teléfono del centro (España)

El centro desvía su número al **número puente**. Los códigos siguientes son los **estándares GSM** de desvío de
llamadas de un móvil; **los operadores pueden variar o no admitirlos, y cada operador publica los suyos**. El centro
debe **comprobar la configuración con su operador** y probarla llamando desde otro teléfono. Si el centro usa una
centralita o una línea fija, el desvío se configura en la centralita o en el área de cliente del operador.

| Qué desvía                    | Activar                          | Desactivar |
| ----------------------------- | -------------------------------- | ---------- |
| Todas las llamadas (siempre)  | `**21*<número puente>#` y llamar | `##21#`    |
| Si no contesta                | `**61*<número puente>#` y llamar | `##61#`    |
| Si comunica (ocupado)         | `**67*<número puente>#` y llamar | `##67#`    |
| Si no hay cobertura / apagado | `**62*<número puente>#` y llamar | `##62#`    |
| Quitar **todos** los desvíos  | `##002#` y llamar                | —          |

- `<número puente>` con el prefijo, por ejemplo `+34910000001`.
- Para "si no contesta" muchos operadores admiten indicar los segundos de espera con
  `**61*<número>**<segundos>#` (por ejemplo 15 o 20 s). **verificar** con el operador.
- Para consultar el estado: `*#21#`, `*#61#`, `*#67#`.
- **Movistar, Vodafone, Orange, Digi y otros:** todos usan en general estos códigos en móvil, pero Movistar, Vodafone
  y Orange ofrecen además el desvío en su área de cliente o aplicación, y en líneas fijas o centralitas se hace de
  otra manera. Digi y operadores virtuales pueden limitar los desvíos. **verificar** con cada operador.
- **«Fuera de horario»** no es un desvío GSM estándar: depende de la centralita o del operador (horarios de desvío).
  Si el centro no puede programarlo, la alternativa es el modo «siempre» y apagar el contestador desde la app fuera
  del horario que quiera. **verificar**.
- El desvío puede tener **coste** para el centro según su tarifa. Debe saberlo antes de activarlo.

### Evitar bucles

El **teléfono de transferencia a una persona** que el centro configura en la app **no puede ser el número del propio
centro ni el número puente**: si lo fuera, la llamada volvería al contestador una y otra vez. El back lo rechaza
(422 `VOICE_TRANSFER_PHONE_INVALID`), pero si el centro desvía su número "siempre" al puente, **debe usar un móvil
distinto** para recibir las transferencias.

---

## 9. Legal y protección de datos (RGPD)

Lista de comprobación antes de abrir el servicio a un centro:

- [ ] **Aviso al inicio de cada llamada**: asistente virtual + la llamada se transcribe para gestionar la cita
      (apartado 5.3). Revisado por tu abogado.
- [ ] **Retención de transcripciones**: elegida por el centro en la app (1–365 días, 30 por defecto). Un barrido
      borra el texto vencido; duración, resumen y resultado se conservan.
- [ ] **Grabación de audio desactivada** en el asistente (o, si se activa, informada y con contrato que lo cubra).
- [ ] **Contrato de encargado del tratamiento (DPA)** entre Yoclick y cada centro actualizado con los subencargados
      siguientes (y entre Yoclick y cada subencargado):

      | Función                        | Proveedor previsto                  |
      | ------------------------------ | ----------------------------------- |
      | Orquestación del agente de voz | Vapi                                |
      | Telefonía y número puente      | Twilio                              |
      | Voz a texto (STT)              | el que se elija en Vapi (p. ej. Deepgram) |
      | Modelo de lenguaje (LLM)       | el que se elija en Vapi             |
      | Texto a voz (TTS)              | el que se elija en Vapi             |

- [ ] **Región y transferencias internacionales** de cada subencargado anotadas (varios están fuera de la UE).
      **verificar** en los términos de cada uno antes de producción.
- [ ] **Información a los alumnos y clientes del centro**: el centro debe incluir en su política de privacidad que sus
      llamadas se atienden con un asistente virtual y se transcriben.
- [ ] **Registro de actividades de tratamiento** actualizado (Yoclick como encargado, el centro como responsable).
- [ ] **Invitados**: se guarda su nombre y teléfono para gestionar la cita; el centro decide qué hacer con ellos. Sus
      datos siguen las reglas del resto de clientes del centro.
- [ ] **Datos en registros**: el back no registra cuerpos ni cabeceras de los avisos. En Vapi, revisa qué se
      registra y durante cuánto tiempo (_Call Logs_).

> Esta lista es práctica, no asesoramiento jurídico: revísala con tu abogado.

### Costes y márgenes (recordatorio)

- Precios y minutos del add-on **no están en el código**: tabla `voice_addon_plans`. Hoy: Básico 49 € / 150 min,
  Pro 69 € / 250 min, Premium 89 € / 400 min, exceso 0,35 €/min (sin IVA).
- Coste real por minuto: lo da cada llamada en el informe de fin (`estimatedCostCents`, en el historial) y el panel
  de facturación de Vapi y Twilio. **verificar** el coste medio por minuto con llamadas reales antes de fijar
  precios definitivos; incluye telefonía, voz a texto, modelo y voz.
- Si la política del centro es «desactivar el bot al agotar los minutos», el coste queda acotado; con «seguir
  cobrando» el exceso se factura a 0,35 €/min y tiene que cubrir el coste real.

---

## 10. Lista de pruebas de extremo a extremo

Haz las pruebas con un centro de prueba y Stripe en **modo test**. Marca cada una. «Dónde mirar» indica dónde
comprobar el resultado.

**Preparación común**

- Centro de prueba con servicios, horarios y, para las pruebas con bonos, el módulo de bonos activo; un alumno de
  prueba con bono y su código (lo ve en el inicio de la app).
- Contestador dado de alta (apartado 7), teléfono de transferencia configurado y el interruptor activado.
- Llama siempre desde un número que no sea el del centro ni el de transferencia.

| #   | Caso                                        | Cómo se prueba                                                                                                      | Resultado esperado                                                                                                             | Dónde mirar                                                                       |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Llamada de un alumno conocido con su código | Llama, di que eres alumno y dicta el código                                                                         | El asistente te saluda por tu nombre de pila (solo el nombre); no dice nada más de ti                                          | Historial de llamadas de la app                                                   |
| 2   | Reserva de un alumno con bono               | Pide un servicio, elige una hora y confirma                                                                         | Reserva creada, descuenta del bono como en la app; el asistente repite la cita                                                 | Agenda del centro, bono del alumno, historial (resultado «Reserva»)               |
| 3   | Código erróneo tres veces                   | Dicta códigos que no existen                                                                                        | Tras el tercero el asistente dice que no puede comprobarlo y pasa la llamada; ese número queda bloqueado 30 min                | Historial (resultado «Transferencia»); nueva llamada inmediata también transfiere |
| 4   | Tope de fallos por centro                   | Hazlo desde muchos números (o baja `VOICE_CENTER_CODE_FAILURES_PER_HOUR` a 2 para probar)                           | Superado el tope, ni el código bueno se acepta: transfiere a una persona                                                       | Historial; restablece la variable después                                         |
| 5   | No alumno: cita de prueba                   | Di que no eres alumno, da tu nombre; elige un servicio marcado «admite cita de prueba»                              | Reserva real como invitado, sin bono                                                                                           | Agenda del centro (alumno invitado); la ficha no cuenta para el tope de clientes  |
| 6   | No alumno: servicio que no es de prueba     | Pide un servicio normal                                                                                             | No lo reserva; ofrece pasar la llamada a una persona                                                                           | Agenda (sin reserva); historial                                                   |
| 7   | Centro sin bonos: cliente nuevo             | Centro sin módulo de bonos (peluquería de prueba): di que no eres cliente                                           | Reserva normal como invitado en cualquier servicio                                                                             | Agenda del centro                                                                 |
| 8   | Cancelar una cita                           | Identifícate, pide cancelar una cita futura y confirma                                                              | Cita cancelada según la política del centro; el asistente explica lo que diga el resultado                                     | Agenda, bono (devuelto o no según la política), historial                         |
| 9   | Cambiar una cita                            | Identifícate, pide cambiarla a otra hora libre                                                                      | Cita movida a la nueva hora                                                                                                    | Agenda                                                                            |
| 10  | Lista de espera (plan Pro)                  | Clase llena en un centro Pro: pide apuntarte                                                                        | Quedas en la lista de espera; el asistente lo confirma                                                                         | Lista de espera de la sesión en la app                                            |
| 11  | Lista de espera en plan Básico              | Mismo caso en un centro Básico (el asistente no debería tener la herramienta)                                       | No apunta; ofrece otra clase o pasar a una persona. Si fuerzas la herramienta, el back devuelve `waitlist_not_included`        | Registro de la llamada en Vapi; historial                                         |
| 12  | Llamada con el desvío «si no contesta»      | Configura `**61*` en el móvil del centro, no contestes y llama desde otro teléfono                                  | A los segundos salta el asistente                                                                                              | Historial de llamadas                                                             |
| 13  | Llamada fuera de horario                    | Con el desvío fuera de horario (si el operador lo permite) o con el modo «siempre» fuera del horario                | El asistente atiende; los horarios los marca la agenda real, no el asistente                                                   | Historial; **verificar** el desvío con el operador                                |
| 14  | Pasar a una persona a petición              | Di «quiero hablar con alguien»                                                                                      | Te pasa al teléfono de transferencia configurado, nunca al del centro                                                          | Historial («Transferencia»); tu teléfono de transferencia suena                   |
| 15  | Sin teléfono de transferencia               | Borra el teléfono de transferencia y pide hablar con alguien                                                        | El asistente pide disculpas y toma nota; no se queda en bucle                                                                  | Historial                                                                         |
| 16  | Al 80 % de los minutos                      | Baja los minutos incluidos de la suscripción de prueba o consume hasta el 80 %                                      | Una notificación en la app, un push y un correo al propietario; solo una vez en el periodo                                     | Notificaciones de la app, correo (consola en desarrollo)                          |
| 17  | Al 100 % con «seguir cobrando»              | Agota los minutos con la política `continue_and_charge`                                                             | El bot sigue atendiendo; llega el aviso del 100 %                                                                              | Notificaciones; historial                                                         |
| 18  | Al 100 % con «desactivar el bot»            | Igual con la política `disable_bot`                                                                                 | El bot deja de atender: la llamada suena como siempre en el teléfono del centro hasta el siguiente periodo                     | Historial (sin llamadas nuevas del bot)                                           |
| 19  | Exceso medido en Stripe (modo test)         | Con `shouldBillWithStripe: true` y minutos agotados, termina una llamada                                            | Llega un evento al medidor `yoclick_voice_minutes` con los minutos de exceso; no se duplica si Vapi repite el informe          | Panel de Stripe (modo test) → Facturación → Medidores                             |
| 20  | Cambio de plan                              | Cambia el plan del centro (p. ej. Básico → Pro)                                                                     | Cambian los minutos incluidos y el precio del add-on; el bot gana o pierde las capacidades de su plan (actualiza el asistente) | Panel de Stripe (líneas de la suscripción), pantalla del contestador              |
| 21  | Retención de transcripciones                | Pon retención de 1 día, espera al barrido (o ejecútalo con el intervalo corto) con una llamada de hace más de 1 día | La transcripción se vacía; duración, resumen y resultado se conservan                                                          | Historial de llamadas                                                             |
| 22  | Interruptor del centro apagado              | Apaga el contestador en la app y llama                                                                              | El bot no atiende (la línea suena normal o dice que no está disponible); las herramientas devuelven «no disponible»            | App (estado «Apagado»); historial                                                 |
| 23  | Secreto incorrecto                          | Cambia el token de la credencial en Vapi y haz una llamada                                                          | Las herramientas fallan (401) y el asistente se disculpa; no se reserva nada                                                   | Registros de Vapi (_Webhooks_)                                                    |
| 24  | Informe de fin repetido                     | Reenvía el mismo `end-of-call-report` desde Vapi                                                                    | Los minutos no se suman dos veces                                                                                              | Consumo de minutos en la app                                                      |
| 25  | Reserva repetida por reintento de Vapi      | Reenvía la misma orden de reserva                                                                                   | La misma reserva, sin duplicar                                                                                                 | Agenda                                                                            |

---

## 11. Pendiente y puntos a vigilar

- **Varias órdenes en un mismo aviso.** Vapi puede mandar varias herramientas en un mismo `toolCallList`. El back
  contesta hoy solo a la primera. Si en las pruebas el asistente llama a dos herramientas a la vez y una se queda sin
  respuesta, hay que ampliar el adaptador. **verificar**.
- **Sincronización del asistente.** Hoy el asistente de cada centro se crea y se actualiza a mano. Cuando haya varios
  centros conviene automatizarlo (crear/actualizar el asistente por API al cambiar el saludo o el plan).
- **Reservar para un hijo por voz** y **enlace de pago por correo (Premium)**: capacidades detectadas pero sin
  herramienta todavía.
- **Invitado que luego se registra:** hoy no se enlaza con su cuenta.
