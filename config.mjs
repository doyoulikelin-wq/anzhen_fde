import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

function parsePublicOrigin(value) {
  if (value === undefined || value === '') return '';
  const message = 'PUBLIC_ORIGIN 必须是完整的 http/https 来源地址，仅包含协议、主机及可选端口，不含路径、账号、参数或通配符。';
  if (typeof value !== 'string' || !/^https?:\/\/[^\s/?#\\*@]+$/i.test(value)) throw new Error(message);
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error(message); }
}

export async function loadConfig(root, environment = process.env) {
  let file = {};
  try { file = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 .env 配置文件。'); }
  const env = { ...file, ...environment };
  const baseURL = (env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
  if (!['https://api.moonshot.cn/v1', 'https://api.moonshot.ai/v1'].includes(baseURL)) throw new Error('KIMI_BASE_URL 只支持官方 Moonshot API 地址。');
  const model = env.KIMI_MODEL || 'kimi-k3';
  if (!['kimi-k3', 'kimi-k2.6'].includes(model)) throw new Error('此 Demo 已适配 kimi-k3 和 kimi-k2.6，请检查 KIMI_MODEL。');
  const effort = env.KIMI_REASONING_EFFORT || 'low';
  if (!['low', 'high', 'max'].includes(effort)) throw new Error('KIMI_REASONING_EFFORT 应为 low、high 或 max。');
  const port = Number(env.PORT || 4173);
  const timeoutMs = Number(env.KIMI_TIMEOUT_MS || 90000);
  const publicOrigin = parsePublicOrigin(env.PUBLIC_ORIGIN);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw new Error('KIMI_TIMEOUT_MS 应在 1000–180000 之间。');
  return { apiKey: (env.MOONSHOT_API_KEY || env.KIMI_API_KEY || '').trim(), baseURL, model, effort, port, timeoutMs, publicOrigin };
}
