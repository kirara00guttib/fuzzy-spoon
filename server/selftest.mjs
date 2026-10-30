// 体检：SigV4 预签名是否正确 + 接口能不能跑通
// 用法：node server/selftest.mjs
import assert from 'node:assert/strict';
import { presignUrl } from './r2.mjs';

// 1) 用 AWS 官方文档里公布的示例向量校验签名算法
//    文档：Authenticating Requests: Using Query Parameters (AWS Signature Version 4)
const vector = presignUrl({
  endpoint: 'examplebucket.s3.amazonaws.com',
  region: 'us-east-1',
  bucket: '', // 文档用的是虚拟主机风格，路径里不带桶名
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  method: 'GET',
  key: 'test.txt',
  expires: 86400,
  date: new Date('2013-05-24T00:00:00.000Z'),
});

const expected =
  'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
assert.equal(
  new URL(vector.url).searchParams.get('X-Amz-Signature'),
  expected,
  'SigV4 签名与 AWS 官方向量不一致',
);
console.log('✓ SigV4 预签名与 AWS 官方示例向量一致');

// 2) 结构检查：PUT 链接必须锁定 content-type，且带过期时间
const put = presignUrl({
  endpoint: 'acc.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'bucket-a',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  method: 'PUT',
  key: 'photos/2025/03/abc.jpg',
  expires: 600,
  contentType: 'image/jpeg',
});
const u = new URL(put.url);
assert.equal(u.protocol, 'https:');
assert.equal(u.host, 'acc.r2.cloudflarestorage.com');
assert.equal(u.pathname, '/bucket-a/photos/2025/03/abc.jpg');
assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host');
assert.ok(u.searchParams.get('X-Amz-Credential').includes('/auto/s3/aws4_request'));
assert.ok(u.searchParams.get('X-Amz-Signature').length === 64);
console.log('✓ PUT 预签名参数正确，且签名头包含 content-type');

// 3) 换用其它 S3 兼容服务时（虚拟主机风格），桶名要进到域名里
const oss = presignUrl({
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
  region: 'cn-hangzhou',
  bucket: 'walk-with-you',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  method: 'PUT',
  key: 'photos/2025/03/abc.jpg',
  pathStyle: false,
  contentType: 'image/jpeg',
});
const ou = new URL(oss.url);
assert.equal(ou.host, 'walk-with-you.oss-cn-hangzhou.aliyuncs.com');
assert.equal(ou.pathname, '/photos/2025/03/abc.jpg');
assert.ok(ou.searchParams.get('X-Amz-Credential').includes('/cn-hangzhou/s3/aws4_request'));
console.log('✓ 虚拟主机风格（OSS / COS / B2 / MinIO）地址正确');

console.log('\n全部通过。');
