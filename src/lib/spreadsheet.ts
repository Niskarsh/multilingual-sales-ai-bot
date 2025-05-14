/**
 * Append one row to a Google Sheet through **NoCodeAPI**.
 * 
 * Sheet tab should have columns:
 *   Date ISO | Name | Voice Key | Transcript Key | Voice URL | Transcript URL
 * 
 * Docs → https://nocodeapi.com/docs/google-sheets-api#add-rows
 */
export async function addRow(
  dateISO: string,
  name: string,
  recordingKey: string,
  transcriptKey: string,
  recordingUrl: string,
  transcriptUrl: string
) {
  // Base URL looks like: https://v1.nocodeapi.com/<user>/google_sheets/<endpointId>
  const url = `${process.env.NOCODEAPI_BASE_URL}?tabId=${process.env.NOCODEAPI_TAB_ID}`;

  // NoCodeAPI expects a 2‑D array of values
  const body = [[
    dateISO,
    name,
    recordingKey,
    transcriptKey,
    recordingUrl,
    transcriptUrl,
  ]];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.NOCODEAPI_KEY!,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`NoCodeAPI error ${res.status}: ${await res.text()}`);
  }
}
