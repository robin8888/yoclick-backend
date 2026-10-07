export const MAX_ROUTINE_NAME_LENGTH = 80;
export const MAX_ROUTINE_NOTE_LENGTH = 500;
export const MAX_ROUTINE_ITEMS = 30;
export const MAX_ITEM_NAME_LENGTH = 120;
export const MAX_ITEM_CATEGORY_LENGTH = 60;
export const MAX_ITEM_PRESCRIPTION_LENGTH = 120;

export interface RoutineItemInput {
  readonly name: string;
  readonly category: string | null;
  readonly prescription: string | null;
}

/** A quién se asigna: a una persona o a un grupo, nunca a las dos cosas. */
export type AssignmentTarget =
  | { readonly kind: 'client'; readonly membershipId: string }
  | { readonly kind: 'group'; readonly groupId: string };

export function buildAssignmentTarget(target: {
  readonly clientMembershipId?: string | undefined;
  readonly groupId?: string | undefined;
}): AssignmentTarget | null {
  if (target.clientMembershipId !== undefined && target.groupId === undefined) {
    return { kind: 'client', membershipId: target.clientMembershipId };
  }
  if (target.groupId !== undefined && target.clientMembershipId === undefined) {
    return { kind: 'group', groupId: target.groupId };
  }
  return null;
}
