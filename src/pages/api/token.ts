import type { NextApiRequest, NextApiResponse } from 'next';
import { prompt } from '../../lib/constant';

export default async function handler(_req: NextApiRequest, res: NextApiResponse){
try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "alloy",
          instructions: prompt,
          input_audio_transcription: {
            model: "whisper-1",
            language: "en"
          },
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
}
