export const CLIENT_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type ClientLevelName = (typeof CLIENT_LEVELS)[number];

export const CLIENT_STATUS_FILTERS = ['active', 'new', 'inactive', 'blocked'] as const;
export type ClientStatusFilter = (typeof CLIENT_STATUS_FILTERS)[number];

export const MIN_GROUP_NAME_LENGTH = 1;
export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_SEARCH_LENGTH = 80;
export const DEFAULT_CLIENT_PAGE_SIZE = 50;
export const MAX_CLIENT_PAGE_SIZE = 100;
/** Un centro con más grupos que esto es un error de uso, no un centro. */
export const MAX_GROUPS_PER_CENTER = 100;
