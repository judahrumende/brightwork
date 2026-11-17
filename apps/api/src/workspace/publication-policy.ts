export function publicationAction(
  publish: boolean,
  draftState: 'draft' | 'pending' | 'approved' | 'rejected',
  draftRevision: number,
  liveRevision: number | undefined,
): 'publish' | 'unpublish' | 'unchanged' | 'reject' {
  if (!publish) return liveRevision === undefined ? 'unchanged' : 'unpublish';
  if (draftState !== 'approved') return 'reject';
  return liveRevision === draftRevision ? 'unchanged' : 'publish';
}
