// Cloudflare Workers 版的 SigV4 预签名（Web Crypto，和本地 Node 版算法一致）
// 本地那份用 node:crypto 实现，这份用 crypto.subtle，两边都有单测对照 AWS 官方向量。

const SERVICE = 's3';
const enc = new TextEncoder();

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return hex(digest);
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data);
  return new Uint8Array(sig);
}

const encodeKey = (key) =>
  key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

/**
 * 生成一条 SigV4 预签名链接
 * @returns {Promise<{url: string, expiresAt: number}>}
 */
export async function presignUrl({
  endpoint,
  region = 'auto',
  bucket,
  accessKeyId,
  secretAccessKey,
  method = 'GET',
  key = '',
  expires = 600,
  contentType = null,
  pathStyle = true,
  date = new Date(),
}) {
  const host = pathStyle && bucket ? endpoint : bucket ? `${bucket}.${endpoint}` : endpoint;
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const canonicalUri = pathStyle && bucket ? `/${bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;

  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const canonicalHeaders = contentType ? `content-type:${contentType}\nhost:${host}\n` : `host:${host}\n`;

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = query.toString();

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(canonicalRequest)].join('\n');

  const kDate = await hmac(enc.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: date.getTime() + expires * 1000,
  };
}

export function r2Config(env) {
  return {
    accountId: env.R2_ACCOUNT_ID || '',
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
    bucket: env.R2_BUCKET || '',
    region: env.R2_REGION || 'auto',
    publicBase: (env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
    endpoint: (env.S3_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    pathStyle: env.S3_PATH_STYLE !== '0',
    get configured() {
      return Boolean(this.accessKeyId && this.secretAccessKey && this.bucket && (this.accountId || this.endpoint));
    },
  };
}

const base = (cfg) => ({
  endpoint: cfg.endpoint || `${cfg.accountId}.r2.cloudflarestorage.com`,
  region: cfg.region,
  bucket: cfg.bucket,
  accessKeyId: cfg.accessKeyId,
  secretAccessKey: cfg.secretAccessKey,
  pathStyle: cfg.pathStyle,
});

export function presignPut(env, key, contentType) {
  const cfg = r2Config(env);
  return presignUrl({ ...base(cfg), method: 'PUT', key, expires: 600, contentType });
}

export async function presignGet(env, key, expires = 6 * 60 * 60) {
  const cfg = r2Config(env);
  if (cfg.publicBase) return { url: `${cfg.publicBase}/${encodeKey(key)}`, expiresAt: Date.now() + expires * 1000 };
  return presignUrl({ ...base(cfg), method: 'GET', key, expires });
}

export function presignDelete(env, key) {
  const cfg = r2Config(env);
  return presignUrl({ ...base(cfg), method: 'DELETE', key, expires: 300 });
}

export { encodeKey };
