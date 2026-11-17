import { createFileRoute } from '@tanstack/react-router';
import { AuthScreen } from '../auth/auth-screen';

export const Route = createFileRoute('/sign-up')({
  component: () => <AuthScreen mode="sign-up" />,
});
