import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl }               from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION! });

export async function presign(key: string) {
  const cmd = new PutObjectCommand({
    Bucket      : process.env.S3_BUCKET,
    Key         : `voice_recordings/${key}`,
    ContentType : key.endsWith('.json')
                  ? 'application/json'
                  : 'audio/webm',
  });
  return getSignedUrl(s3, cmd, { expiresIn: 1800 }); // 15 min
}
