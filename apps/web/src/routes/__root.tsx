import { createRootRoute, HeadContent, Outlet } from '@tanstack/react-router';
import { brand } from '@brightwork/shared';
import { PreviewLink } from '../ui/preview-link';

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: brand.product }] }),
  component: () => (
    <>
      <HeadContent />
      <Outlet />
    </>
  ),
  notFoundComponent: () => <PreviewLink title="Page not found" />,
});
