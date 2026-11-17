export function workNotificationKey(item: {
  id: string;
  kind: string;
  state: string;
  revision: number;
  answered: boolean;
}) {
  if (item.kind === 'question')
    return item.answered ? null : 'question:' + item.id;
  if (item.state === 'pending') return `creation:${item.id}:${item.revision}`;
  return null;
}
