import { useRef, useState } from 'react';
import NameModal from '@/components/NameModal';

/* ── helper types ────────────────────────────────────────── */
interface Keys  { recKey: string; trKey: string }
interface Event {
  type?: string;
  item?: { type?: string; role?: string; content?: { text?: string }[] };
}

/* ── component ───────────────────────────────────────────── */
export default function Home() {
  /* ── UI / session state ──────────────────────────────── */
  const [name,  setName]     = useState('');
  const [showModal, setShow] = useState(true);
  const [active, setActive]  = useState(false);
  const [isStopping, setIsStopping] = useState(false);   // ← added
  const [events, setEvents]  = useState<Event[]>([]);
  const [keys,   setKeys]    = useState<Keys | null>(null);

  /* ── WebRTC / media refs ─────────────────────────────── */
  const pcRef  = useRef<RTCPeerConnection|null>(null);
  const dcRef  = useRef<RTCDataChannel|null>(null);
  const micRef = useRef<MediaStream|null>(null);
  const aiRef  = useRef<MediaStream|null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const recRef    = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderStarted = useRef(false);

  /* ── combine mic + AI into MediaRecorder ─────────────── */
  function maybeRecord() {
    if (recorderStarted.current || !micRef.current || !aiRef.current) return;

    const ctx  = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(micRef.current!).connect(dest);
    ctx.createMediaStreamSource(aiRef.current!).connect(dest);

    const rec = new MediaRecorder(dest.stream);
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.start();
    recRef.current = rec;
    recorderStarted.current = true;
  }

  /* ── startSession (unchanged from previous answers) ──── */
  const startSession = async () => {
    const init = await fetch('/api/init', {
      method: 'POST',
      body  : JSON.stringify({ name }),
    }).then((r) => r.json());
    setKeys(init);

    const { client_secret } = await fetch('/api/token').then((r) => r.json());
    const ephemKey = client_secret.value;

    /* audio element */
    if (!remoteAudioRef.current) {
      const au = document.createElement('audio');
      au.autoplay = true; au.style.display = 'none';
      document.body.appendChild(au);
      remoteAudioRef.current = au;
    }

    /* PeerConnection */
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    pc.ontrack = (e) => {
      aiRef.current = e.streams[0];
      remoteAudioRef.current!.srcObject = e.streams[0];
      maybeRecord();
    };

    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micRef.current = mic;
    pc.addTrack(mic.getAudioTracks()[0]);
    maybeRecord();

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try { setEvents((p) => [...p, JSON.parse(e.data)]); } catch {}
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answer = await fetch(
      'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
      {
        method: 'POST',
        headers: {
          Authorization : `Bearer ${ephemKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      },
    ).then((r) => r.text());

    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    dc.onopen = () => {
      setActive(true);
      setEvents([]);

      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type   : 'message',
          role   : 'user',
          content: [{ type: 'input_text', text: 'Hi there!' }],
        },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    };
  };

  /* ── stopSession (with CloudFront + sheet row + spinner) ─ */
  const stopSession = async () => {
    if (!recRef.current) return;
    setIsStopping(true);

    await new Promise<void>((resolve) => {
      recRef.current!.addEventListener(
        'stop',
        async () => {
          /* blobs */
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const transcriptBlob = new Blob(
            [JSON.stringify(events, null, 2)],
            { type: 'application/json' },
          );

          /* PUT to S3 */
          if (keys) {
            const { urls: putUrls } = await fetch('/api/presign', {
              method: 'POST',
              body  : JSON.stringify({ keys: [keys.recKey, keys.trKey] }),
            }).then((r) => r.json());

            await Promise.all([
              fetch(putUrls[0], { method: 'PUT', body: audioBlob }),
              fetch(putUrls[1], { method: 'PUT', body: transcriptBlob }),
            ]);
          }

          /* CloudFront URLs */
          const { urls: cfUrls } = await fetch('/api/cfurls', {
            method: 'POST',
            body  : JSON.stringify({ keys: [keys!.recKey, keys!.trKey] }),
          }).then((r) => r.json());

          /* sheet row */
          await fetch('/api/record', {
            method: 'POST',
            body: JSON.stringify({
              name,
              recKey: keys!.recKey,
              trKey : keys!.trKey,
              recUrl: cfUrls[0],
              trUrl : cfUrls[1],
            }),
          });

          resolve();
        },
        { once: true },
      );

      recRef.current!.stop();
    });

    /* cleanup */
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());

    recorderStarted.current = false;
    setActive(false);
    setIsStopping(false);
  };

  /* ── render ───────────────────────────────────────────── */
  return (
    <>
      {showModal && (
        <NameModal
          name={name}
          setName={setName}
          onConfirm={() => setShow(false)}
        />
      )}

      <nav className="fixed top-0 left-0 right-0 h-14 flex items-center px-4 bg-white border-b">
        <h1 className="text-lg font-medium">Realtime Console</h1>
      </nav>

      <main className="absolute top-14 left-0 right-0 bottom-0 flex">
        {/* control + event log */}
        <section className="flex-1 p-4">
          <button
            className="px-4 py-2 mr-4 rounded bg-green-600 text-white disabled:opacity-50"
            disabled={active || !name}
            onClick={startSession}
          >
            Start
          </button>

          <button
            className="px-4 py-2 rounded bg-red-600 text-white disabled:opacity-50"
            disabled={!active || isStopping}
            onClick={stopSession}
          >
            {isStopping ? 'Stopping…' : 'Stop'}
          </button>

          <pre className="mt-4 h-[calc(100%-80px)] overflow-y-auto text-xs">
            {events.map((e, i) => (
              <div key={i}>{JSON.stringify(e)}</div>
            ))}
          </pre>
        </section>

        {/* simple transcript view */}
        <section className="w-96 border-l p-4 bg-gray-900 text-green-300 overflow-y-auto">
          {events
            .filter((ev) => ev.item?.type === 'message')
            .map((ev, i) => (
              <p key={i}>
                <b>{ev.item?.role ?? '?'}</b>: {ev.item?.content?.[0]?.text ?? ''}
              </p>
            ))}
        </section>
      </main>
    </>
  );
}
