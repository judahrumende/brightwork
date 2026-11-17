import { createFileRoute } from '@tanstack/react-router';
import { brand } from '@brightwork/shared';
import { UiGallery } from '../ui/ui-gallery';

export const Route = createFileRoute('/dev/ui')({
  head: () => ({ meta: [{ title: `UI preview · ${brand.product}` }] }),
  component: UiGallery,
});
