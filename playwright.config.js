import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',timeout:45000,use:{baseURL:'http://127.0.0.1:5173',channel:'chrome',headless:true,viewport:{width:1440,height:960},screenshot:'only-on-failure'},workers:1,reporter:'list'});
