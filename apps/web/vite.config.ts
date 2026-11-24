import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const workspace = fileURLToPath(new URL('../..', import.meta.url));
  const desktop = process.env.BRIGHTWORK_DESKTOP_PIP === '1';
  const envDir = desktop ? false : workspace;
  const env = desktop ? process.env : loadEnv(mode, workspace, '');
  const origin = new URL(env.APP_ORIGIN || 'http://127.0.0.1:5173');
  const isLocalHttpOrigin =
    origin.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  return {
    envDir,
    plugins: [tanstackRouter({ target: 'react' }), react()],
    server: {
      port: isLocalHttpOrigin && origin.port ? Number(origin.port) : 5173,
      strictPort: true,
      proxy: {
        '/auth/callback': `http://127.0.0.1:${env.API_PORT || '3001'}`,
        '/api': `http://127.0.0.1:${env.API_PORT || '3001'}`,
        '/health': `http://127.0.0.1:${env.API_PORT || '3001'}`,
        '/ready': `http://127.0.0.1:${env.API_PORT || '3001'}`,
      },
    },
  };
});
