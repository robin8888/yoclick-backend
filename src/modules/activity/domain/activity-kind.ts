/**
 * Lo que queda anotado en el registro de actividad. La frase («cambió el servicio X») se compone
 * en la app con el idioma y el vocabulario del centro; aquí solo va el tipo y sobre qué fue.
 */
export const ACTIVITY_KINDS = [
  'service_created',
  'service_updated',
  'service_archived',
  'room_created',
  'room_archived',
  'client_updated',
  'clients_imported',
  'group_created',
  'group_archived',
  'team_member_updated',
  'team_member_removed',
  'settings_updated',
  'join_code_regenerated',
  'booking_created_by_team',
  'booking_cancelled_by_team',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
