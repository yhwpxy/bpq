import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const LLM_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));
const unavailable = message => Object.freeze({ enabled: false, code: 50301, message });

/** Pure configuration validation; injected environments keep tests away from real credentials. */
export function readLlmConfig(env = process.env) {
  const fields = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
  for (const field of fields) {
    if (typeof env[field] !== 'string' || !env[field].trim()) return unavailable(`未配置 ${field}，自然语言分解暂不可用`);
  }
  const apiKey = env.LLM_API_KEY.trim();
  const model = env.LLM_MODEL.trim();
  if (/[\r\n]/.test(apiKey) || /[\r\n]/.test(model)) return unavailable('模型配置包含非法换行，请检查 LLM_API_KEY 和 LLM_MODEL');
  let url;
  try { url = new URL(env.LLM_BASE_URL.trim()); } catch { return unavailable('LLM_BASE_URL 必须是完整的 HTTP(S) API 根地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return unavailable('LLM_BASE_URL 只允许 HTTP(S) API 根地址，不能包含账号、查询参数或片段');
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol === 'http:' && !loopback) return unavailable('远程模型服务必须使用 HTTPS；仅本机回环地址允许 HTTP');
  const baseUrl = url.toString().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url.pathname.replace(/\/+$/, ''))) return unavailable('LLM_BASE_URL 应填写 API 根地址，不要包含 /chat/completions');
  return Object.freeze({ enabled: true, apiKey, model, baseUrl, endpoint: `${baseUrl}/chat/completions` });
}

/** Only the CLI entrypoint loads .env. Importing createApp never reads a developer's file. */
export function loadLlmEnvironment({ env = process.env, filePath = LLM_ENV_PATH } = {}) {
  const result = dotenv.config({ path: path.resolve(filePath), processEnv: env, override: false, quiet: true });
  if (result.error && result.error.code !== 'ENOENT') return unavailable('无法读取模型配置文件，请检查仓库根目录 .env 的访问权限');
  return readLlmConfig(env);
}
