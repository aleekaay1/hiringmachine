import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;
              if (id.includes('jspdf') || id.includes('pdfjs') || id.includes('react-pdf')) return 'vendor-pdf';
              if (id.includes('tesseract')) return 'vendor-ocr';
              if (id.includes('mammoth')) return 'vendor-docx';
              if (id.includes('framer-motion')) return 'vendor-motion';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
            },
          },
        },
      },
    };
});
