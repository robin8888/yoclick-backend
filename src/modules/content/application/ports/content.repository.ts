import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ClientLevelName } from '../../../clients/domain/client-rules';
import { type VideoStatusName } from '../../../videos/domain/video-rules';
import { type ContentTarget } from '../../domain/content-rules';

export type ContentKindName = 'video' | 'pdf' | 'image';

/** A quién se le enseña la pieza: `label` es el nombre del grupo o de la persona (nulo si es un nivel). */
export interface StoredContentAssignment {
  readonly id: string;
  readonly level: ClientLevelName | null;
  readonly groupId: string | null;
  readonly clientMembershipId: string | null;
  readonly label: string | null;
}

export interface StoredContent {
  readonly id: string;
  readonly kind: ContentKindName;
  readonly title: string;
  readonly need: string | null;
  readonly level: ClientLevelName | null;
  readonly sizeBytes: bigint;
  readonly pageCount: number | null;
  readonly createdAt: Date;
  readonly documentKey: string | null;
  /** Solo en los vídeos: el vídeo alojado en el servicio de vídeo. */
  readonly video: {
    readonly providerVideoId: string;
    readonly status: VideoStatusName;
    readonly durationSeconds: number | null;
  } | null;
  readonly assignments: readonly StoredContentAssignment[];
}

export interface ContentDetails {
  readonly title: string;
  readonly need: string | null;
  readonly level: ClientLevelName | null;
}

/** Lo que se cambia de una pieza; lo que no llega se queda como está. */
export interface ContentChanges {
  readonly title?: string | undefined;
  readonly need?: string | null | undefined;
  readonly level?: ClientLevelName | null | undefined;
}

export interface NewDocument extends ContentDetails {
  readonly id: string;
  readonly kind: 'pdf' | 'image';
  readonly documentKey: string;
  readonly sizeBytes: bigint;
  readonly pageCount: number | null;
}

export interface NewVideoContent extends ContentDetails {
  readonly id: string;
  readonly videoId: string;
}

export interface DocumentStorageFacts {
  readonly storageLimitBytes: bigint;
  readonly usedBytes: bigint;
}

export type AddVideoOutcome = 'added' | 'video_not_found' | 'video_already_in_library';
export type ReplaceAssignmentsOutcome = 'replaced' | 'not_found' | 'invalid_target';

/** Lo que hay que borrar fuera de la base de datos cuando se quita una pieza. */
export interface RemovedContent {
  readonly documentKey: string | null;
  /** El vídeo que se borra con la pieza; nulo si es un PDF o si el vídeo se usa en una rutina. */
  readonly orphanedProviderVideoId: string | null;
}

export interface ContentRepository {
  readDocumentStorageFacts(actor: ActorContext): Promise<DocumentStorageFacts>;
  list(actor: ActorContext): Promise<StoredContent[]>;
  find(actor: ActorContext, contentId: string): Promise<StoredContent | null>;
  addDocument(actor: ActorContext, document: NewDocument): Promise<void>;
  addVideo(actor: ActorContext, video: NewVideoContent): Promise<AddVideoOutcome>;
  update(
    actor: ActorContext,
    contentId: string,
    changes: ContentChanges,
  ): Promise<StoredContent | null>;
  replaceAssignments(
    actor: ActorContext,
    request: { contentId: string; targets: readonly ContentTarget[] },
  ): Promise<ReplaceAssignmentsOutcome>;
  remove(actor: ActorContext, contentId: string): Promise<RemovedContent | null>;
  /** Lo que se le ha asignado a quien pregunta (por nivel, grupo o a él), con los vídeos ya listos. */
  listForClient(actor: ActorContext): Promise<StoredContent[]>;
  findForClient(actor: ActorContext, contentId: string): Promise<StoredContent | null>;
}

export const CONTENT_REPOSITORY = Symbol('CONTENT_REPOSITORY');
