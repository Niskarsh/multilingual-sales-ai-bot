import { useRef, useState, useEffect } from 'react';
import NameModal from '@/components/NameModal';

interface Keys { recKey: string; trKey: string; }
interface ChatMsg { role: 'user' | 'assistant'; text: string; }

export default function Home() {
  /* ── UI + state ───────────────────────────────────────────── */
  const [name, setName] = useState('');
  const [showModal, setShowModal] = useState(true);
  const [active, setActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const [events, setEvents] = useState<any[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [keys, setKeys] = useState<Keys | null>(null);

  /* ── WebRTC + recording refs ──────────────────────────────── */
  const pcRef  = useRef<RTCPeerConnection|null>(null);
  const dcRef  = useRef<RTCDataChannel|null>(null);
  const micRef = useRef<MediaStream|null>(null);
  const aiRef  = useRef<MediaStream|null>(null);

  const recRef    = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderStarted = useRef(false);
  const remoteAudioRef  = useRef<HTMLAudioElement|null>(null);
  const transcriptBox   = useRef<HTMLDivElement|null>(null);

  /* ── helpers ──────────────────────────────────────────────── */
  function maybeRecord() {
    if (recorderStarted.current || !micRef.current || !aiRef.current) return;
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(micRef.current).connect(dest);
    ctx.createMediaStreamSource(aiRef.current).connect(dest);

    const rec = new MediaRecorder(dest.stream);
    rec.ondataavailable = e => chunksRef.current.push(e.data);
    rec.start();
    recRef.current = rec;
    recorderStarted.current = true;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      transcriptBox.current?.scrollTo({ top: transcriptBox.current.scrollHeight, behavior: 'smooth' });
    });
  }

  /* ── start session ────────────────────────────────────────── */
  const startSession = async () => {
    setIsStarting(true);

    const init = await fetch('/api/init', { method:'POST', body: JSON.stringify({ name }) }).then(r=>r.json());
    setKeys(init);

    const { client_secret } = await fetch('/api/token').then(r=>r.json());
    const ephem = client_secret.value;

    const pc = new RTCPeerConnection(); pcRef.current = pc;

    if (!remoteAudioRef.current) {
      const el = document.createElement('audio');
      el.autoplay = true; el.style.display = 'none';
      document.body.appendChild(el);
      remoteAudioRef.current = el;
    }
    pc.ontrack = e => { aiRef.current = e.streams[0]; remoteAudioRef.current!.srcObject = e.streams[0]; maybeRecord(); };

    const mic = await navigator.mediaDevices.getUserMedia({ audio:true });
    micRef.current = mic; pc.addTrack(mic.getAudioTracks()[0]); maybeRecord();

    const dc = pc.createDataChannel('oai-events'); dcRef.current = dc;
    dc.addEventListener('message', e => handleServerEvent(JSON.parse(e.data)));

    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const model = 'gpt-4o-realtime-preview-2024-12-17';
    const answer = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method:'POST', headers:{ Authorization:`Bearer ${ephem}`, 'Content-Type':'application/sdp' }, body: offer.sdp
    }).then(r=>r.text());
    await pc.setRemoteDescription({ type:'answer', sdp: answer });

    dc.addEventListener('open', () => {
      setActive(true); setIsStarting(false);
      dc.send(JSON.stringify({
        type:'conversation.item.create',
        item:{ type:'message', role:'user', content:[{ type:'input_text', text:'Hi there!' }] },
      }));
      dc.send(JSON.stringify({ type:'response.create' }));
    });
  };

  /* ── server event parser → chat bubbles ───────────────────── */
  function handleServerEvent(ev: any) {
    setEvents(prev => [...prev, ev]);               // keep raw log if you want it

    /* user speech transcript */
    if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      const txt = ev.transcript?.trim();
      if (txt) setMessages(m => [...m, { role:'user', text: txt }]);
    }

    /* assistant final message */
    if (ev.type === 'response.done') {
      const text = ev.response?.output?.[0]?.content?.[0]?.transcript ?? '';
      if (text) setMessages(m => [...m, { role:'assistant', text }]);
    }
  }

  /* auto-scroll chat */
  useEffect(scrollToBottom, [messages]);

  /* ── stop session ─────────────────────────────────────────── */
  const stopSession = async () => {
    if (!recRef.current) return;
    setIsStopping(true);

    await new Promise<void>((resolve) => {
      recRef.current!.addEventListener('stop', async () => {
        const audioBlob = new Blob(chunksRef.current, { type:'audio/webm' });
        const transcriptBlob = new Blob([JSON.stringify(events,null,2)], { type:'application/json' });

        if (keys) {
          const { urls } = await fetch('/api/presign', {
            method:'POST', body: JSON.stringify({ keys:[keys.recKey, keys.trKey] })
          }).then(r=>r.json());
          await Promise.all([
            fetch(urls[0], { method:'PUT', body: audioBlob }),
            fetch(urls[1], { method:'PUT', body: transcriptBlob })
          ]);
        }
        resolve();
      }, { once:true });

      recRef.current!.stop();
    });

    dcRef.current?.close(); pcRef.current?.close();
    micRef.current?.getTracks().forEach(t=>t.stop());
    recorderStarted.current = false;
    setActive(false); setIsStopping(false);
  };

  /* ── UI ───────────────────────────────────────────────────── */
  return (
    <>
      {showModal && <NameModal name={name} setName={setName} onConfirm={()=>setShowModal(false)} />}

      <nav className="fixed top-0 left-0 right-0 h-14 flex items-center px-4 bg-white shadow z-10">
        <h1 className="text-lg font-semibold">Realtime Voice Console</h1>
      </nav>

      <main className="absolute top-14 inset-x-0 bottom-0 flex">
        {/* left controls + raw event log (collapsible if you like) */}
        <section className="w-56 p-4 border-r space-y-4 overflow-y-auto">
          <button
            className="w-full flex items-center justify-center gap-2 rounded bg-green-600 text-white py-2 disabled:opacity-50"
            disabled={active || !name || isStarting}
            onClick={startSession}
          >
            {isStarting && <Spinner />} Start
          </button>
          <button
            className="w-full flex items-center justify-center gap-2 rounded bg-red-600 text-white py-2 disabled:opacity-50"
            disabled={!active || isStopping}
            onClick={stopSession}
          >
            {isStopping && <Spinner />} Stop
          </button>

          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium">Raw events</summary>
            <pre className="mt-2 text-[10px] max-h-64 overflow-y-auto">{events.map((e,i)=><div key={i}>{JSON.stringify(e)}</div>)}</pre>
          </details>
        </section>

        {/* right transcript */}
        <section ref={transcriptBox} className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto scroll-smooth bg-gray-50">
          {messages.map((m,i)=>(
            <div key={i} className={`max-w-sm px-4 py-2 rounded-xl shadow
              ${m.role==='user' ? 'ml-auto bg-blue-600 text-white' : 'mr-auto bg-slate-200 text-slate-900'}`}>
              {m.text}
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

/* simple spinner component */
const Spinner = () => (
  <svg className="size-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);
