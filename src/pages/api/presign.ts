import type { NextApiRequest, NextApiResponse } from 'next';
import { presign } from '@/lib/s3';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { keys } = JSON.parse(req.body) as { keys: string[] };
  const urls = await Promise.all(keys.map(presign));
  res.json({ urls });
}
