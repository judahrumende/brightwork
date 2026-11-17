import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const workspace = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, workspace, '');
  return {
    envDir: workspace,
    plugins: [tanstackRouter({ target: 'react' }), react()],
    server: {
      strictPort: true,
      proxy: {
        '/auth/callback': `http://127.0.0.1:${env.API_PORT || '3001'}`,
        '/api': `http://127.0.0.1:${env.API_PORT || '3001'}`,
        '/health': `http://127.0.0.1:${env.API_PORT || '3001'}`,
      },
    },
  };
});
