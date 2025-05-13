import { useRef, useState } from 'react';
import NameModal from '@/components/NameModal';

interface Keys { recKey: string; trKey: string }
interface Event {
  type?: string;
  item?: { type?: string; role?: string; content?: { text?: string }[] };
}

export default function Home() {
  const [name, setName]   = useState('');
  const [showModal, setShowModal] = useState(true);
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [keys,   setKeys]   = useState<Keys | null>(null);

  const pcRef  = useRef<RTCPeerConnection|null>(null);
  const dcRef  = useRef<RTCDataChannel|null>(null);
  const micRef = useRef<MediaStream|null>(null);
  const aiRef  = useRef<MediaStream|null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const recRef    = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderStarted = useRef(false);

  function maybeRecord() {
    if (recorderStarted.current || !micRef.current || !aiRef.current) return;
    const ctx  = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(micRef.current!).connect(dest);
    ctx.createMediaStreamSource(aiRef.current!).connect(dest);

    const rec = new MediaRecorder(dest.stream);
    rec.ondataavailable = e => chunksRef.current.push(e.data);
    rec.start();
    recRef.current = rec;
    recorderStarted.current = true;
  }

  /* ─ start ─ */
  const startSession = async () => {
    const init = await fetch('/api/init', {
      method: 'POST', body: JSON.stringify({ name })
    }).then(r => r.json());
    setKeys(init);

    const { client_secret } = await fetch('/api/token').then(r => r.json());
    const ephemKey = client_secret.value;

    if (!remoteAudioRef.current) {
      const el = document.createElement('audio');
      el.style.display = 'none';      // keep UI clean
      el.autoplay      = true;        // Chrome permits because Start-btn = gesture
      document.body.appendChild(el);
      remoteAudioRef.current = el;
    }

    const pc = new RTCPeerConnection();  pcRef.current = pc;
    // pc.ontrack = e => { aiRef.current = e.streams[0]; maybeRecord(); };

    /* handle remote track */
    pc.ontrack = e => {
      aiRef.current = e.streams[0];    // for recording mix
      remoteAudioRef.current!.srcObject = e.streams[0];   // 🔊 PLAY
      maybeRecord();
    };

    
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micRef.current = mic;  pc.addTrack(mic.getAudioTracks()[0]);  maybeRecord();

    const dc = pc.createDataChannel('oai-events');  dcRef.current = dc;
    dc.addEventListener('message', e => {
      try { setEvents(prev => [...prev, JSON.parse(e.data)]); } catch {}
    });

    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const model = 'gpt-4o-realtime-preview-2024-12-17';
    const answer = await fetch(
      `https://api.openai.com/v1/realtime?model=${model}`,
      {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemKey}`, 'Content-Type': 'application/sdp' },
      }
    ).then(r => r.text());
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    /* 🔑 kick-off once channel is ready */
    dc.addEventListener('open', () => {
      setActive(true); setEvents([]);

      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hi there!' }],   // ← input_text!
        },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    });
  };

  /* ─ stop ─ */
  const stopSession = async () => {
    recRef.current?.stop();
    const audio = new Blob(chunksRef.current, { type: 'audio/webm' });
    const transcript = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });

    if (keys) {
      const { urls } = await fetch('/api/presign', {
        method:'POST', body: JSON.stringify({ keys: [keys.recKey, keys.trKey] })
      }).then(r => r.json());
      await Promise.all([
        fetch(urls[0], { method:'PUT', body: audio }),
        fetch(urls[1], { method:'PUT', body: transcript }),
      ]);
    }
    dcRef.current?.close(); pcRef.current?.close();
    micRef.current?.getTracks().forEach(t => t.stop());
    recorderStarted.current = false; setActive(false);
  };

  /* ─ UI ─ */
  return (
    <>
      {showModal && <NameModal name={name} setName={setName} onConfirm={() => setShowModal(false)} />}
      <nav className="fixed top-0 left-0 right-0 h-14 flex items-center px-4 bg-white border-b">
        <h1 className="text-lg font-medium">Realtime Console</h1>
      </nav>

      <main className="absolute top-14 left-0 right-0 bottom-0 flex">
        <section className="flex-1 p-4">
          <button className="px-4 py-2 mr-4 rounded bg-green-600 text-white disabled:opacity-50"
                  disabled={active || !name} onClick={startSession}>Start</button>
          <button className="px-4 py-2 rounded bg-red-600 text-white disabled:opacity-50"
                  disabled={!active} onClick={stopSession}>Stop</button>

          <pre className="mt-4 h-[calc(100%-80px)] overflow-y-auto text-xs">
            {events.map((e,i)=><div key={i}>{JSON.stringify(e)}</div>)}
          </pre>
        </section>

        <section className="w-96 border-l p-4 bg-gray-900 text-green-300 overflow-y-auto">
          {events.filter(ev=>ev.item?.type==='message').map((ev,i)=>(
            <p key={i}><b>{ev.item?.role ?? '???'}</b>: {ev.item?.content?.[0]?.text ?? ''}</p>
          ))}
        </section>
      </main>
    </>
  );
}
