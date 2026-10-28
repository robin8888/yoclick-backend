/**
 * Cómo se reconoce en Stripe el add-on del Contestador IA. El producto del add-on lleva este id (no empieza por
 * `yoclick_plan_`, así que el cobro de los planes nunca lo confunde con un plan) y el medidor, este nombre de evento.
 */
export const VOICE_ADDON_PRODUCT_ID = 'yoclick_voice_addon';
export const VOICE_METER_EVENT_NAME = 'yoclick_voice_minutes';
