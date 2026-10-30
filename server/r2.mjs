// Cloudflare R2（S3 兼容）预签名 URL。
// 只用 node:crypto 手写 SigV4 —— 密钥永远只留在服务端，
// 浏览器拿到的是一条几分钟后就失效、且只能动这一张图的链接。
import crypto from 'node:crypto';
import { R2 } from './config.mjs';

const SERVICE = 's3';

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s, 'utf8').digest();

function encodeKey(key) {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * 纯函数：生成一条 SigV4 预签名链接（不读写任何全局状态，方便单测）
 * @returns {{url: string, expiresAt: number}}
 */
export function presignUrl({
  endpoint,
  region = 'auto',
  bucket,
  accessKeyId,
  secretAccessKey,
  method = 'GET',
  key = '',
  expires = 600,
  contentType = null,
  date = new Date(),
  pathStyle = true,
}) {
  // R2 用自己的域名，桶名放在路径里；多数其它 S3（OSS / COS / B2 / MinIO）用 bucket.host
  const host = pathStyle ? endpoint : `${bucket}.${endpoint}`;
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const canonicalUri = pathStyle && bucket ? `/${bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;

  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const canonicalHeaders = contentType
    ? `content-type:${contentType}\nhost:${host}\n`
    : `host:${host}\n`;

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = query.toString();

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: date.getTime() + expires * 1000,
  };
}

const endpoint = () => R2.endpoint || `${R2.accountId}.r2.cloudflarestorage.com`;

function common() {
  return {
    endpoint: endpoint(),
    region: R2.region,
    bucket: R2.bucket,
    accessKeyId: R2.accessKeyId,
    secretAccessKey: R2.secretAccessKey,
    pathStyle: R2.pathStyle,
  };
}

/** 上传用的 PUT 链接（10 分钟有效，签名绑定 Content-Type） */
export function presignPut(key, contentType) {
  return presignUrl({ ...common(), method: 'PUT', key, expires: 600, contentType });
}

/** 读取用的 GET 链接 */
export function presignGet(key, expires = 6 * 60 * 60) {
  if (R2.publicBase) {
    return { url: `${R2.publicBase}/${encodeKey(key)}`, expiresAt: Date.now() + expires * 1000 };
  }
  return presignUrl({ ...common(), method: 'GET', key, expires });
}

/** 任意操作（DELETE / HEAD 等） */
export function presignObject({ method, key, expires = 300 }) {
  return presignUrl({ ...common(), method, key, expires });
}

export function r2Ready() {
  return R2.configured;
}
