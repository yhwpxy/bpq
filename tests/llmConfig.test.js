import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLlmConfig, loadLlmEnvironment, LLM_ENV_PATH } from '../backend/config/llm.js';
const env = () => ({ LLM_API_KEY: 'test-key-never-real', LLM_BASE_URL: 'https://model.example.test/v1/', LLM_MODEL: 'test-model' });
let dir;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-llm-config-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('模型配置只读验证与根目录环境加载', () => {
  it('读取三个必要字段并统一 endpoint，不修改输入环境', () => {
    const source = env(), before = { ...source }; const config = readLlmConfig(source);
    expect(config).toEqual({ enabled: true, apiKey: source.LLM_API_KEY, model: 'test-model', baseUrl: 'https://model.example.test/v1', endpoint: 'https://model.example.test/v1/chat/completions' });
    expect(source).toEqual(before); expect(Object.isFrozen(config)).toBe(true);
  });
  it.each(['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'])('未配置 %s 不崩溃且原因明确', field => {
    const source = env(); delete source[field]; expect(readLlmConfig(source)).toMatchObject({ enabled: false, code: 50301, message: expect.stringContaining(field) });
  });
  it.each(['ftp://host/v1', 'https://user:pass@host/v1', 'https://host/v1?key=secret', 'https://host/v1#fragment', 'http://model.example.test/v1', 'http://127.attacker.example/v1', 'not-a-url', 'https://host/v1/chat/completions'])('拒绝不合法或可能泄漏密钥的URL %s', url => { expect(readLlmConfig({ ...env(), LLM_BASE_URL: url }).enabled).toBe(false); });
  it.each(['http://localhost:9999/v1', 'http://127.0.0.1:9999/v1', 'http://[::1]:9999/v1'])('本地模型允许HTTP %s', url => { expect(readLlmConfig({ ...env(), LLM_BASE_URL: url }).enabled).toBe(true); });
  it('拒绝请求头换行，错误中不包含密钥', () => {
    const config = readLlmConfig({ ...env(), LLM_API_KEY: 'secret\ninjected' }); expect(config.enabled).toBe(false); expect(JSON.stringify(config)).not.toContain('secret');
  });
  it('从显式根.env路径加载，进程环境优先且不会读取当前目录的文件', async () => {
    const filePath = path.join(dir, '.env');
    await writeFile(filePath, 'LLM_API_KEY=file-key\nLLM_BASE_URL=https://fixture.test/v1\nLLM_MODEL=file-model\n');
    const processEnv = { LLM_API_KEY: 'environment-key' }; const result = loadLlmEnvironment({ env: processEnv, filePath });
    expect(result).toMatchObject({ apiKey: 'environment-key', model: 'file-model', endpoint: 'https://fixture.test/v1/chat/completions' });
    expect(LLM_ENV_PATH).toBe(fileURLToPath(new URL('../.env', import.meta.url)));
  });
  it('没有.env文件仍能使用显式环境，完全未配置保持disabled', () => {
    const filePath = path.join(dir, 'missing'); expect(loadLlmEnvironment({ env: env(), filePath }).enabled).toBe(true); expect(loadLlmEnvironment({ env: {}, filePath }).enabled).toBe(false);
  });
});
