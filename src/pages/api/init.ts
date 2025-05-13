import type { NextApiRequest, NextApiResponse } from 'next';
import { addRow } from '@/lib/spreadsheet';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name } = JSON.parse(req.body) as { name: string };
  const stamp     = Date.now();
  const safe      = name.trim().replace(/\s+/g, '_').toUpperCase();

  const recKey = `VOICE_RECORDING_${safe}_${stamp}.webm`;
  const trKey  = `TRANSCRIPT_${safe}_${stamp}.json`;

  await addRow(new Date().toISOString(), name, recKey, trKey);
  res.json({ recKey, trKey });
}
