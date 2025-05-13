/**
 * Append one row to Google Sheets through NoCodeAPI.
 * Docs → https://nocodeapi.com/docs/google-sheets-api/ (Add Rows)
 */
export async function addRow(
    dateISO: string,
    name: string,
    recordingKey: string,
    transcriptKey: string
  ) {
    const url =
      `${process.env.NOCODEAPI_BASE_URL}?tabId=${process.env.NOCODEAPI_TAB_ID}`;
    const body = [[dateISO, name, recordingKey, transcriptKey]]; // 2-D array
  
    const res = await fetch(url, {
      method : 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 'X-API-KEY'   : process.env.NOCODEAPI_KEY!,
      },
      body: JSON.stringify(body),
    });
  
    if (!res.ok)
      throw new Error(`NoCodeAPI error ${res.status}: ${await res.text()}`);
  }
  