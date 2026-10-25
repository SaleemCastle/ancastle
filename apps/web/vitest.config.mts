import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
        alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
    },
    test: { include: ['lib/**/*.test.ts'], setupFiles: ['./test/setup-env.ts'] },
});
