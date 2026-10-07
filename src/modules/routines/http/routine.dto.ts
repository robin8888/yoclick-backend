import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  MAX_ITEM_CATEGORY_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_PRESCRIPTION_LENGTH,
  MAX_ROUTINE_ITEMS,
  MAX_ROUTINE_NAME_LENGTH,
  MAX_ROUTINE_NOTE_LENGTH,
} from '../domain/routine-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class RoutineRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), routineId: z.uuid() }),
) {}

export class AssignmentRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), routineId: z.uuid(), assignmentId: z.uuid() }),
) {}

/** Una cadena vacía (campo en blanco del formulario) cuenta como «no viene». */
const optionalText = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(maxLength).nullable().default(null),
  );

const itemSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_ITEM_NAME_LENGTH),
  category: optionalText(MAX_ITEM_CATEGORY_LENGTH),
  /** Texto libre: «4 × 10 · 16 kg», «5 min». */
  prescription: optionalText(MAX_ITEM_PRESCRIPTION_LENGTH),
});

/** A una persona o a un grupo: exactamente uno de los dos. */
const targetSchema = z
  .strictObject({ clientMembershipId: z.uuid().optional(), groupId: z.uuid().optional() })
  .refine(
    ({ clientMembershipId, groupId }) =>
      (clientMembershipId === undefined) !== (groupId === undefined),
    'send a client or a group, not both',
  );

export class CreateRoutineRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(1).max(MAX_ROUTINE_NAME_LENGTH),
    note: optionalText(MAX_ROUTINE_NOTE_LENGTH),
    items: z.array(itemSchema).min(1).max(MAX_ROUTINE_ITEMS),
    /** Si se envía, la rutina se asigna al crearla. */
    assignTo: targetSchema.optional(),
  }),
) {}

export class AssignRoutineRequestDto extends createZodDto(targetSchema) {}

const exerciseShape = {
  name: z.string(),
  category: z.string().nullable(),
  prescription: z.string().nullable(),
};

const assignmentShape = {
  id: z.uuid(),
  kind: z.enum(['client', 'group']),
  /** Nombre de la persona o del grupo. */
  targetName: z.string(),
  assignedAt: z.iso.datetime(),
};

const detailShape = {
  id: z.uuid(),
  name: z.string(),
  note: z.string().nullable(),
  items: z.array(z.strictObject(exerciseShape)),
  assignments: z.array(z.strictObject(assignmentShape)),
  createdAt: z.iso.datetime(),
};

export class RoutineDetailResponseDto extends createZodDto(z.strictObject(detailShape)) {}

export class RoutineListResponseDto extends createZodDto(
  z.strictObject({
    routines: z.array(
      z.strictObject({
        id: z.uuid(),
        name: z.string(),
        itemCount: z.number().int(),
        assignmentCount: z.number().int(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
) {}

export class ExerciseLibraryResponseDto extends createZodDto(
  z.strictObject({
    /** Los ejercicios del tipo de centro, para empezar una rutina sin escribirlo todo. */
    exercises: z.array(z.strictObject({ name: z.string(), category: z.string() })),
  }),
) {}

export class MyRoutinesResponseDto extends createZodDto(
  z.strictObject({
    routines: z.array(
      z.strictObject({
        id: z.uuid(),
        name: z.string(),
        note: z.string().nullable(),
        items: z.array(z.strictObject(exerciseShape)),
        /** Cuándo le llegó (la asignación más reciente, directa o por su grupo). */
        assignedAt: z.iso.datetime(),
      }),
    ),
  }),
) {}
