import type { NextApiRequest, NextApiResponse } from 'next';
import { cfUrl } from '@/lib/cloudfront';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { keys } = JSON.parse(req.body) as { keys: string[] };
  const urls = keys.map(cfUrl);
  res.json({ urls });
}
