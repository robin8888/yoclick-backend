/** `true` si algún valor de `If-None-Match` (lista, `*` o validador débil `W/`) coincide con el ETag. */
export function matchesIfNoneMatch(
  ifNoneMatchHeader: string | undefined,
  entityTag: string,
): boolean {
  if (!ifNoneMatchHeader) return false;
  const presentedTags = ifNoneMatchHeader.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  return presentedTags.includes('*') || presentedTags.includes(entityTag);
}
