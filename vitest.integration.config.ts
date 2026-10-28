import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/integration/**/*.integration.ts'],environment:'node',fileParallelism:false,maxWorkers:1,testTimeout:15000,hookTimeout:15000}});
