import { createFileRoute } from '@tanstack/react-router';
import { MagicLinkScreen } from '../auth/auth-screen';

export const Route = createFileRoute('/sign-in_/link')({
  component: MagicLinkScreen,
});
