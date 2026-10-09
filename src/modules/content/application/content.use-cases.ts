import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { type ErrorCode } from '../../../shared/errors/error-catalog.es';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { decidePhotoUpload } from '../../photos/domain/photo-rules';
import { VIDEO_HOSTING, type VideoHosting } from '../../videos/application/ports/video-hosting';
import {
  buildDocumentKey,
  buildImageKey,
  countPdfPages,
  decideDocumentUpload,
  isPdfFile,
  type ContentTarget,
  type DocumentUploadDecision,
} from '../domain/content-rules';
import {
  CONTENT_REPOSITORY,
  type ContentChanges,
  type ContentDetails,
  type ContentRepository,
  type DocumentStorageFacts,
  type StoredContent,
} from './ports/content.repository';
import { FILE_STORAGE, type FileStorage } from './ports/file-storage';

const REFUSED_UPLOAD_ERRORS: Readonly<
  Record<Exclude<DocumentUploadDecision, 'allowed'>, readonly [ErrorCode, number]>
> = {
  too_large: ['DOCUMENT_TOO_LARGE', HTTP_STATUS.payloadTooLarge],
  quota_exceeded: ['DOCUMENT_QUOTA_EXCEEDED', HTTP_STATUS.conflict],
};

async function requireContent(
  contents: ContentRepository,
  actor: ActorContext,
  contentId: string,
): Promise<StoredContent> {
  const content = await contents.find(actor, contentId);
  if (!content) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  return content;
}

@Injectable()
export class ListContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  async execute(
    actor: ActorContext,
  ): Promise<{ items: StoredContent[]; storage: DocumentStorageFacts }> {
    const [items, storage] = await Promise.all([
      this.contents.list(actor),
      this.contents.readDocumentStorageFacts(actor),
    ]);
    return { items, storage };
  }
}

export interface AddDocumentRequest extends ContentDetails {
  readonly actor: ActorContext;
  readonly bytes: Buffer;
}

export interface StoredFileRequest extends AddDocumentRequest {
  readonly kind: 'pdf' | 'image';
  readonly contentId: string;
  /** Ruta del fichero en el almacén. */
  readonly documentKey: string;
  /** Solo los PDF tienen páginas. */
  readonly pageCount: number | null;
}

/** Guarda un fichero de la biblioteca (PDF o imagen): comprueba el espacio del plan, lo sube y lo registra. */
@Injectable()
export class StoreContentFileUseCase {
  private readonly logger = new Logger(StoreContentFileUseCase.name);

  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async execute(request: StoredFileRequest): Promise<StoredContent> {
    await this.assertRoomFor(request);
    await this.storage.putFile({ key: request.documentKey, bytes: request.bytes });
    await this.saveOrDiscard(request);
    return requireContent(this.contents, request.actor, request.contentId);
  }

  private async assertRoomFor(request: AddDocumentRequest): Promise<void> {
    const facts = await this.contents.readDocumentStorageFacts(request.actor);
    const decision = decideDocumentUpload({
      ...facts,
      requestedBytes: BigInt(request.bytes.length),
    });
    if (decision === 'allowed') return;
    const [code, httpStatus] = REFUSED_UPLOAD_ERRORS[decision];
    throw new DomainError(code, httpStatus);
  }

  /** Un fichero que sobra en el almacén solo cuesta dinero: si no se pudo guardar, se intenta borrar. */
  private async saveOrDiscard(request: StoredFileRequest): Promise<void> {
    try {
      await this.contents.addDocument(request.actor, {
        id: request.contentId,
        kind: request.kind,
        documentKey: request.documentKey,
        title: request.title,
        need: request.need,
        level: request.level,
        sizeBytes: BigInt(request.bytes.length),
        pageCount: request.pageCount,
      });
    } catch (error) {
      await this.storage.deleteFile(request.documentKey).catch((deleteError: unknown) => {
        this.logger.warn(
          `Could not delete ${request.documentKey} from the file storage`,
          deleteError,
        );
      });
      throw error;
    }
  }
}

@Injectable()
export class AddDocumentUseCase {
  constructor(private readonly storeFile: StoreContentFileUseCase) {}

  async execute(request: AddDocumentRequest): Promise<StoredContent> {
    if (!isPdfFile(request.bytes))
      throw new DomainError('DOCUMENT_NOT_PDF', HTTP_STATUS.badRequest);
    const contentId = generateUuidV7();
    return this.storeFile.execute({
      ...request,
      kind: 'pdf',
      contentId,
      documentKey: buildDocumentKey({ centerId: request.actor.centerId, contentId }),
      pageCount: countPdfPages(request.bytes),
    });
  }
}

@Injectable()
export class AddImageUseCase {
  constructor(private readonly storeFile: StoreContentFileUseCase) {}

  /** El formato se lee de los bytes, con las mismas reglas que las fotos de perfil. */
  async execute(request: AddDocumentRequest): Promise<StoredContent> {
    const decision = decidePhotoUpload(request.bytes);
    if (decision.kind === 'not_an_image') {
      throw new DomainError('PHOTO_NOT_IMAGE', HTTP_STATUS.badRequest);
    }
    if (decision.kind === 'too_large') {
      throw new DomainError('PHOTO_TOO_LARGE', HTTP_STATUS.payloadTooLarge);
    }
    const contentId = generateUuidV7();
    return this.storeFile.execute({
      ...request,
      kind: 'image',
      contentId,
      documentKey: buildImageKey({
        centerId: request.actor.centerId,
        contentId,
        format: decision.format,
      }),
      pageCount: null,
    });
  }
}

export interface AddVideoRequest extends ContentDetails {
  readonly actor: ActorContext;
  readonly videoId: string;
}

@Injectable()
export class AddVideoContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  async execute(request: AddVideoRequest): Promise<StoredContent> {
    const contentId = generateUuidV7();
    const outcome = await this.contents.addVideo(request.actor, {
      id: contentId,
      videoId: request.videoId,
      title: request.title,
      need: request.need,
      level: request.level,
    });
    if (outcome === 'video_not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome === 'video_already_in_library') {
      throw new DomainError('CONTENT_VIDEO_ALREADY_IN_LIBRARY', HTTP_STATUS.conflict);
    }
    return requireContent(this.contents, request.actor, contentId);
  }
}

@Injectable()
export class UpdateContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  async execute(
    actor: ActorContext,
    request: { contentId: string; changes: ContentChanges },
  ): Promise<StoredContent> {
    const updated = await this.contents.update(actor, request.contentId, request.changes);
    if (!updated) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return updated;
  }
}

@Injectable()
export class AssignContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  /** Sustituye a quién se le enseña la pieza: la lista que llega es la que queda. */
  async execute(
    actor: ActorContext,
    request: { contentId: string; targets: readonly ContentTarget[] },
  ): Promise<StoredContent> {
    const outcome = await this.contents.replaceAssignments(actor, request);
    if (outcome === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome === 'invalid_target') {
      throw new DomainError('CONTENT_ASSIGNMENT_INVALID', HTTP_STATUS.unprocessableEntity);
    }
    return requireContent(this.contents, actor, request.contentId);
  }
}

@Injectable()
export class RemoveContentUseCase {
  private readonly logger = new Logger(RemoveContentUseCase.name);

  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(VIDEO_HOSTING) private readonly videoHosting: VideoHosting,
  ) {}

  async execute(actor: ActorContext, contentId: string): Promise<void> {
    const removed = await this.contents.remove(actor, contentId);
    if (!removed) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    await this.discard('file', removed.documentKey, (key) => this.storage.deleteFile(key));
    await this.discard('video', removed.orphanedProviderVideoId, (id) =>
      this.videoHosting.deleteVideo(id),
    );
  }

  /** Lo que sobra fuera de la base de datos solo cuesta dinero: se intenta borrar y, si falla, queda constancia. */
  private async discard(
    what: string,
    reference: string | null,
    remove: (reference: string) => Promise<void>,
  ): Promise<void> {
    if (reference === null) return;
    try {
      await remove(reference);
    } catch (error) {
      this.logger.warn(`Could not delete ${what} ${reference}`, error);
    }
  }
}

@Injectable()
export class ListMyContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  async execute(actor: ActorContext): Promise<StoredContent[]> {
    return this.contents.listForClient(actor);
  }
}

@Injectable()
export class GetMyContentUseCase {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly contents: ContentRepository) {}

  async execute(actor: ActorContext, contentId: string): Promise<StoredContent> {
    const content = await this.contents.findForClient(actor, contentId);
    if (!content) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return content;
  }
}
