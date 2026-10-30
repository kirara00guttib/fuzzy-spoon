// 用 AWS 官方示例向量校验 Worker 版（Web Crypto）的 SigV4 签名
import assert from 'node:assert/strict';
import { presignUrl } from './sigv4.mjs';

const vector = await presignUrl({
  endpoint: 'examplebucket.s3.amazonaws.com',
  region: 'us-east-1',
  bucket: '',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  method: 'GET',
  key: 'test.txt',
  expires: 86400,
  date: new Date('2013-05-24T00:00:00.000Z'),
});
const sig = new URL(vector.url).searchParams.get('X-Amz-Signature');
assert.equal(sig, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404', 'Worker 版 SigV4 与 AWS 向量不一致');
console.log('✓ Worker 版 SigV4 与 AWS 官方示例向量一致');

const isoss = await presignUrl({
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
const u = new URL(isoss.url);
assert.equal(u.host, 'walk-with-you.oss-cn-hangzhou.aliyuncs.com');
assert.equal(u.pathname, '/photos/2025/03/abc.jpg');
console.log('✓ Worker 版虚拟主机风格地址正确');
