import type { NextApiRequest, NextApiResponse } from 'next';
import { addRow } from '@/lib/spreadsheet';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, recKey, trKey, recUrl, trUrl } = JSON.parse(req.body);

  await addRow(
    new Date().toISOString(),
    name,
    recKey,
    trKey,
    recUrl,
    trUrl,
  );

  res.status(200).end();
}
