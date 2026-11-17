import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.js'], testTimeout:15000, hookTimeout:15000, poolOptions:{threads:{maxThreads:4,minThreads:1}}}});
