import { useRef, useState, useEffect } from 'react';
import NameModal from '@/components/NameModal';

/* ── types ──────────────────────────────────────────────── */
interface Keys   { recKey: string; trKey: string }
interface ChatMsg{ role: 'user' | 'assistant'; text: string }

/* ── tiny spinner svg ───────────────────────────────────── */
const Spinner = () => (
  <svg className="size-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
    <path   d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            fill="currentColor" className="opacity-75"/>
  </svg>
);

export default function Home() {
  /* ── UI + status ─────────────────────────────────────── */
  const [name,setName]       = useState('');
  const [showModal,setModal] = useState(true);
  const [active,setActive]   = useState(false);
  const [starting,setStart]  = useState(false);
  const [stopping,setStop ]  = useState(false);

  const [keys,setKeys] = useState<Keys|null>(null);
  const [events,setEv] = useState<any[]>([]);
  const [msgs,setMsg ] = useState<ChatMsg[]>([]);

  /* ── WebRTC + recording refs ─────────────────────────── */
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const dcRef = useRef<RTCDataChannel|null>(null);
  const micRef= useRef<MediaStream|null>(null);
  const aiRef = useRef<MediaStream|null>(null);

  const recRef    = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderStarted = useRef(false);
  const remoteAudioRef  = useRef<HTMLAudioElement|null>(null);

  /* ── chat autoscroll ─────────────────────────────────── */
  const chatBox = useRef<HTMLDivElement|null>(null);
  useEffect(()=>{ chatBox.current?.scrollTo({top:chatBox.current.scrollHeight, behavior:'smooth'}); },[msgs]);

  /* ── mix mic+AI → MediaRecorder ──────────────────────── */
  function maybeRecord() {
    if (recorderStarted.current || !micRef.current || !aiRef.current) return;
    const ctx  = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(micRef.current).connect(dest);
    ctx.createMediaStreamSource(aiRef.current ).connect(dest);

    const rec = new MediaRecorder(dest.stream);
    rec.ondataavailable = e => chunksRef.current.push(e.data);
    rec.start();
    recRef.current = rec;
    recorderStarted.current = true;
  }

  /* ── server-event → transcript bubbles ───────────────── */
  function handleServerEvent(ev: any) {
    setEv(p=>[...p, ev]);

    if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      const t = ev.transcript?.trim(); if (t) setMsg(m=>[...m,{role:'user', text:t}]);
    }

    if (ev.type === 'response.done') {
      const txt = ev.response?.output?.[0]?.content?.[0]?.transcript ?? '';
      if (txt) setMsg(m=>[...m,{role:'assistant',text:txt}]);
    }
  }

  /* ── start session ───────────────────────────────────── */
  const startSession = async () => {
    setStart(true);
    /* 0) sheet row + keys */
    const init = await fetch('/api/init',{method:'POST',body:JSON.stringify({name})}).then(r=>r.json());
    setKeys(init);

    /* 1) token */
    const { client_secret } = await fetch('/api/token').then(r=>r.json());
    const ephem = client_secret.value;

    /* 2) peer connection */
    const pc = new RTCPeerConnection(); pcRef.current = pc;

    /* remote audio → play */
    if (!remoteAudioRef.current) {
      const el=document.createElement('audio'); el.autoplay=true; el.style.display='none';
      document.body.appendChild(el); remoteAudioRef.current = el;
    }
    pc.ontrack = e => { aiRef.current=e.streams[0]; remoteAudioRef.current!.srcObject=e.streams[0]; maybeRecord(); };

    /* mic */
    const mic = await navigator.mediaDevices.getUserMedia({audio:true});
    micRef.current = mic; pc.addTrack(mic.getAudioTracks()[0]); maybeRecord();

    /* data channel */
    const dc = pc.createDataChannel('oai-events'); dcRef.current=dc;
    dc.onmessage = e => { try{handleServerEvent(JSON.parse(e.data))}catch{} };

    /* SDP */
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const answer = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',{
      method:'POST',
      headers:{Authorization:`Bearer ${ephem}`,'Content-Type':'application/sdp'},
      body:offer.sdp
    }).then(r=>r.text());
    await pc.setRemoteDescription({type:'answer', sdp:answer });

    dc.onopen = () => {
      setActive(true); setStart(false);
      dc.send(JSON.stringify({
        type:'conversation.item.create',
        item:{ type:'message', role:'user', content:[{type:'input_text',text:'Hi there!'}] }
      }));
      dc.send(JSON.stringify({type:'response.create'}));
    };
  };

  /* ── stop session ────────────────────────────────────── */
  const stopSession = async () => {
    if (!recRef.current) return;
    setStop(true);

    await new Promise<void>(resolve=>{
      recRef.current!.addEventListener('stop',async()=>{
        const audio = new Blob(chunksRef.current,{type:'audio/webm'});
        const tr    = new Blob([JSON.stringify(events,null,2)],{type:'application/json'});

        if (keys) {
          const {urls} = await fetch('/api/presign',{method:'POST',body:JSON.stringify({keys:[keys.recKey,keys.trKey]})}).then(r=>r.json());
          await Promise.all([
            fetch(urls[0],{method:'PUT',body:audio}),
            fetch(urls[1],{method:'PUT',body:tr})
          ]);
        }
        resolve();
      },{once:true});
      recRef.current!.stop();
    });

    dcRef.current?.close(); pcRef.current?.close();
    micRef.current?.getTracks().forEach(t=>t.stop());
    recorderStarted.current=false; setActive(false); setStop(false);
  };

  /* ── UI ──────────────────────────────────────────────── */
  return (
    <>
      {showModal && <NameModal name={name} setName={setName} onConfirm={()=>setModal(false)}/>}

      {/* top bar */}
      <header className="fixed inset-x-0 top-0 h-14 flex items-center px-6 bg-white shadow z-10">
        <h1 className="text-lg font-semibold">Realtime Voice Console</h1>
      </header>

      <main className="pt-14 grid grid-cols-[240px_1fr] h-[calc(100vh-56px)] bg-gray-100">
        {/* sidebar */}
        <aside className="border-r bg-white p-4 space-y-4">
          <button
            onClick={startSession}
            disabled={active||!name||starting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-white disabled:opacity-40">
            {starting&&<Spinner/>} Start
          </button>
          <button
            onClick={stopSession}
            disabled={!active||stopping}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-white disabled:opacity-40">
            {stopping&&<Spinner/>} Stop
          </button>

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer font-medium">Raw events</summary>
            <pre className="mt-2 max-h-64 overflow-y-auto text-[10px]">
              {events.map((e,i)=><div key={i}>{JSON.stringify(e)}</div>)}
            </pre>
          </details>
        </aside>

        {/* transcript */}
        <section ref={chatBox} className="overflow-y-auto p-6 space-y-4">
          {msgs.map((m,i)=>(
            <div key={i}
                 className={`max-w-[65%] px-4 py-2 rounded-xl shadow
                   ${m.role==='user'
                     ? 'ml-auto bg-blue-600 text-white'
                     : 'mr-auto bg-slate-200 text-slate-900'}`}>
              {m.text}
            </div>
          ))}
          {!msgs.length && (
            <p className="mt-24 text-center text-gray-400">
              No messages yet – hit <b>Start</b> and begin talking
            </p>
          )}
        </section>
      </main>
    </>
  );
}
