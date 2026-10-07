export interface VideoUploadTarget {
  /** Dirección a la que el móvil sube el fichero directamente (protocolo TUS). */
  readonly endpoint: string;
  /** Cabeceras que el móvil debe enviar tal cual; incluyen una firma que caduca. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface VideoProcessingState {
  readonly bunnyStatusCode: number;
  readonly sizeBytes: bigint;
  readonly durationSeconds: number | null;
}

export interface VideoPlaybackLinks {
  readonly streamUrl: string;
  readonly thumbnailUrl: string;
  readonly expiresAt: Date;
}

/** El servicio que aloja y reproduce los vídeos. La base de datos solo guarda sus datos. */
export interface VideoHosting {
  createVideo(title: string): Promise<{ providerVideoId: string }>;
  signUpload(providerVideoId: string): VideoUploadTarget;
  fetchProcessingState(providerVideoId: string): Promise<VideoProcessingState | null>;
  signPlayback(providerVideoId: string): VideoPlaybackLinks;
  deleteVideo(providerVideoId: string): Promise<void>;
}

export const VIDEO_HOSTING = Symbol('VIDEO_HOSTING');
