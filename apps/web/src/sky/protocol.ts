export type SkyMessage =
  | { type: 'start'; canvas: OffscreenCanvas; source: string }
  | { type: 'resize'; width: number; height: number; ratio: number }
  | { type: 'visibility'; visible: boolean };
