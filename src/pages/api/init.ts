import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name } = JSON.parse(req.body) as { name: string };
  const stamp = Date.now();
  const safe  = name.trim().replace(/\s+/g, '_').toUpperCase();

  res.json({
    recKey: `VOICE_RECORDING_${safe}_${stamp}.webm`,
    trKey : `TRANSCRIPT_${safe}_${stamp}.json`,
  });
}
