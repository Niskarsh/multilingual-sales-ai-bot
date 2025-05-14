import { getSignedUrl as sign } from '@aws-sdk/cloudfront-signer';

const rawDomain = process.env.CLOUDFRONT_DOMAIN!.replace(/^https?:\/\//, ''); // ← fix
const keyId     = process.env.CLOUDFRONT_KEY_PAIR_ID!;
const privKey   = process.env.CLOUDFRONT_PRIVATE_KEY!.replace(/\\n/g, '\n');

const twentyYears = 20 * 365 * 24 * 60 * 60;           // seconds
const expires     = Math.floor(Date.now() / 1000) + twentyYears;

export function cfUrl(objectKey: string) {
  const url = `https://${rawDomain}/voice_recordings/${objectKey}`;          // no double protocol
  return sign({
    url,
    keyPairId    : keyId,
    dateLessThan : new Date(expires * 1000),
    privateKey   : privKey,
  });
}
