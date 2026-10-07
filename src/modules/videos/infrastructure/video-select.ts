/** Las columnas de un vídeo que necesita quien lo muestra; compartido con las rutinas, que lo anidan en sus ejercicios. */
export const VIDEO_SELECT = {
  id: true,
  providerVideoId: true,
  title: true,
  status: true,
  reviewStatus: true,
  reviewNote: true,
  sizeBytes: true,
  durationSeconds: true,
  uploadedByMembershipId: true,
} as const;
