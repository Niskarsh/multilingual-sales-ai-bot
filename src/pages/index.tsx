import { useRef, useState, useEffect } from 'react';
import NameModal from '@/components/NameModal';
import { PROMPT_MD } from '@/lib/constant';

/* ── types ------------------------------------------------------------ */
interface Keys  { recKey: string; trKey: string }
interface ChatMsg { role: 'user' | 'assistant'; text: string }

/* ultra-light Markdown ➜ HTML
   ─ supports: h2, h3, **bold**, *italics*, tables, <br> */
   function mdToHtml(md: string) {
    /* tables -------------- */
    const TABLE_RE =
      /^(\|.+\|)[\r\n]+(\|[ :\-|]+\|)[\r\n]+((\|.*\|[\r\n]+)+)/gm;
  
    md = md.replace(TABLE_RE, (_m, head, _sep, body) => {
      const headHtml: string = head
        .slice(1, -1)                     // trim outer pipes
        .split('|')
        .map((c: string): string => `<th>${c.trim()}</th>`)
        .join('');
  
      const rowsHtml: string = body
        .trim()
        .split('\n')
        .map((r: string): string =>
          '<tr>' +
          r.slice(1, -1)                  // trim outer pipes
           .split('|')
           .map((c: string): string => `<td>${c.trim()}</td>`).join('') +
          '</tr>')
        .join('');
  
      return `<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    });
  
    /* headings / emphasis / line-breaks */
    return md
      .replace(/^### (.*)$/gim, '<h3>$1</h3>')
      .replace(/^## (.*)$/gim, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/g,  '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,      '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }
  
/* ── component -------------------------------------------------------- */
export default function Home() {
  /* – UI / session state – */
  const [name,  setName]     = useState('');
  const [modal, setModal]    = useState(true);
  const [active,setActive]   = useState(false);
  const [isStarting,setStart]  = useState(false);   // NEW
  const [isStopping,setStop] = useState(false);
  const [finished,   setFinished]=useState(false);

  const [keys, setKeys]      = useState<Keys|null>(null);
  const [events,setEvents]   = useState<ServerEvent[]>([]);
  const [msgs, setMsgs]      = useState<ChatMsg[]>([]);

  /* – refs – */
  const pcRef  = useRef<RTCPeerConnection|null>(null);
  const dcRef  = useRef<RTCDataChannel|null>(null);
  const micRef = useRef<MediaStream|null>(null);
  const aiRef  = useRef<MediaStream|null>(null);
  const audioRef = useRef<HTMLAudioElement|null>(null);

  const recRef    = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef= useRef(false);

  const transcriptBox = useRef<HTMLDivElement|null>(null);

  /* – auto-scroll chat – */
  useEffect(()=>{
    transcriptBox.current?.scrollTo({
      top: transcriptBox.current.scrollHeight,
      behavior: 'smooth',
    });
  },[msgs]);

  /* – helper: mix mic + AI and start recorder – */
  function maybeRecord() {
    if (startedRef.current || !micRef.current || !aiRef.current) return;

    const ctx  = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(micRef.current!).connect(dest);
    ctx.createMediaStreamSource(aiRef.current!).connect(dest);

    const rec = new MediaRecorder(dest.stream);
    rec.ondataavailable = e => chunksRef.current.push(e.data);
    rec.start();
    recRef.current = rec;
    startedRef.current = true;
  }

  /* – server event → messages – */
  interface ServerEvent {
    type: string;
    transcript?: string;
    response?: {
      output?: Array<{
        content?: Array<{
          transcript?: string;
        }>;
      }>;
    };
  }

  function handleServerEvent(ev: ServerEvent) {
    setEvents(p=>[...p, ev]);

    if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      const t = ev.transcript?.trim();
      if (t) setMsgs(m=>[...m, { role:'user', text:t }]);
    }

    if (ev.type === 'response.done') {
      const txt = ev.response?.output?.[0]?.content?.[0]?.transcript ?? '';
      if (txt) setMsgs(m=>[...m, { role:'assistant', text:txt }]);
    }
  }

  /* – START – */
  const startSession = async () => {
    setFinished(false);
    setStart(true);                               // spinner ON
    /* 0) keys for S3 objects */
    const init = await fetch('/api/init',{
      method:'POST', body:JSON.stringify({ name })
    }).then(r=>r.json());
    setKeys(init);

    /* 1) ephem token */
    const { client_secret } = await fetch('/api/token').then(r=>r.json());
    const ephem = client_secret.value;

    /* audio element (hidden) */
    if (!audioRef.current) {
      const el = document.createElement('audio');
      el.autoplay = true; el.style.display = 'none';
      document.body.appendChild(el);
      audioRef.current = el;
    }

    /* 2) PeerConnection */
    const pc = new RTCPeerConnection(); pcRef.current = pc;

    pc.ontrack = e => {
      aiRef.current = e.streams[0];
      audioRef.current!.srcObject = e.streams[0];
      maybeRecord();
    };

    /* mic */
    const mic = await navigator.mediaDevices.getUserMedia({ audio:true });
    micRef.current = mic; pc.addTrack(mic.getAudioTracks()[0]); maybeRecord();

    /* data channel */
    const dc = pc.createDataChannel('oai-events'); dcRef.current = dc;
    dc.onmessage = e => { try{handleServerEvent(JSON.parse(e.data))}catch{} };

    /* SDP */
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const answerSdp = await fetch(
      'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
      { method:'POST', headers:{Authorization:`Bearer ${ephem}`,'Content-Type':'application/sdp'}, body:offer.sdp }
    ).then(r=>r.text());
    await pc.setRemoteDescription({ type:'answer', sdp:answerSdp });

    dc.onopen = () => {
      setStart(false);                            // spinner OFF
      setActive(true); setEvents([]); setMsgs([]);

      dc.send(JSON.stringify({
        type:'conversation.item.create',
        item:{ type:'message', role:'user', content:[{type:'input_text',text:'Hi there!'}] }
      }));
      dc.send(JSON.stringify({ type:'response.create' }));
    };
  };

  /* – STOP – */
  const stopSession = async () => {
    if (!recRef.current) return;
    setStop(true);

    await new Promise<void>((resolve)=>{
      recRef.current!.addEventListener('stop', async () => {
        /* blobs */
        const audioBlob = new Blob(chunksRef.current,{type:'audio/webm'});
        const transcriptBlob = new Blob(
          [JSON.stringify(events,null,2)], {type:'application/json'}
        );

        /* S3 PUT */
        if (keys) {
          const { urls: putUrls } = await fetch('/api/presign',{
            method:'POST', body:JSON.stringify({ keys:[keys.recKey, keys.trKey] })
          }).then(r=>r.json());

          await Promise.all([
            fetch(putUrls[0],{ method:'PUT', body:audioBlob }),
            fetch(putUrls[1],{ method:'PUT', body:transcriptBlob }),
          ]);
        }

        /* CloudFront URLs */
        const { urls: cfUrls } = await fetch('/api/cfurls',{
          method:'POST', body:JSON.stringify({ keys:[keys!.recKey, keys!.trKey] })
        }).then(r=>r.json());

        /* sheet row via NoCodeAPI */
        await fetch('/api/record',{
          method:'POST',
          body:JSON.stringify({
            name,
            recKey: keys!.recKey,
            trKey : keys!.trKey,
            recUrl: cfUrls[0],
            trUrl : cfUrls[1],
          }),
        });

        resolve();
      }, { once:true });

      recRef.current!.stop();
    });

    /* cleanup */
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach(t=>t.stop());

    startedRef.current=false; setActive(false); setStop(false);
    setFinished(true);             // show “Assignment Complete” & lock buttons

  };

  /* – render – */
  return (
    <>
      {modal && <NameModal name={name} setName={setName} onConfirm={()=>setModal(false)} />}

      <header className="topbar"><h1>SP Tamil Pilot</h1></header>

      <div className="wrapper">
        {/* sidebar */}
        <aside className="sidebar">
          {/* <button className="btn start" disabled={active||!name} onClick={startSession}>Start</button> */}
          <button className="btn start" disabled={active || !name || isStarting || finished} onClick={startSession}>
          {isStarting ? 'Starting…' : 'Start'}
        </button>
          <button className="btn stop"  disabled={!active || isStopping || finished} onClick={stopSession}>
            {isStopping?'Stopping…':'Stop'}
          </button>
          {finished && <div className="done-banner">Assignment&nbsp;Complete ✔</div>}

          {/* full markdown prompt */}
          <div className="prompt" dangerouslySetInnerHTML={{__html: mdToHtml(PROMPT_MD)}} />

          <details>
            <summary>Raw events</summary>
            <pre className="details-box">
              {events.map((e,i)=><div key={i}>{JSON.stringify(e)}</div>)}
            </pre>
          </details>
        </aside>

        {/* transcript */}
        <section ref={transcriptBox} className="transcript">
          {msgs.length===0 && <p className="empty-state">Press <b>Start</b> to begin talking.</p>}
          {msgs.map((m,i)=>(
            <div key={i} className={`bubble ${m.role==='user'?'user':'ai'}`}>{m.text}</div>
          ))}
        </section>
      </div>
    </>
  );
}
