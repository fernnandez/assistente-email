import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://127.0.0.1:3210';
// Em desenvolvimento a interface roda em :5173 e repassa a API; reescrevemos Host/Origin para passar nas
// validações de segurança do servidor (que só aceita o próprio endereço).
const proxy = { target: API, changeOrigin: true, headers: { Origin: API } };

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': proxy, '/auth': proxy, '/oauth': proxy } },
});
