import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

function buildLlmProxy(env: Record<string, string>) {
  const provider = env.VITE_LLM_PROVIDER || 'openai';
  const fallbackBaseUrl = provider === 'ollama'
    ? 'http://localhost:11434'
    : 'http://127.0.0.1:1234/v1';
  const rawBaseUrl = env.VITE_LLM_BASE_URL || fallbackBaseUrl;
  const parsedBaseUrl = new URL(rawBaseUrl);
  const targetOrigin = parsedBaseUrl.origin;
  const targetPath = parsedBaseUrl.pathname.replace(/\/$/, '');

  return {
    target: targetOrigin,
    changeOrigin: true,
    secure: false,
    rewrite: (requestPath: string) => {
      const upstreamPath = requestPath.replace(/^\/api\/llm/, '');
      return `${targetPath}${upstreamPath}` || '/';
    },
  };
}

function buildExerciseDbProxy() {
  return {
    target: 'https://exercisedb.dev',
    changeOrigin: true,
    secure: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api\/exercise-db/, ''),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/llm': buildLlmProxy(env),
        '/api/exercise-db': buildExerciseDbProxy(),
      },
    },
  };
});
