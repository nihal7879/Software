import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';

// AssemblyAI Universal-Streaming (English): the microphone goes straight to
// them over a WebSocket and words come back while you are still speaking.
const WS_URL = 'wss://streaming.assemblyai.com/v3/ws';
const SPEECH_MODEL = 'universal-streaming-english';
// Audio is sent in small slices; their guidance is 50-1000 ms per message.
const CHUNK_MS = 100;
const WANT_SAMPLE_RATE = 16000;
// A remark is a sentence or two — stop on our own if someone forgets to.
const MAX_SECONDS = 180;

// Hidden for now, everywhere the button is used. Set to true to bring Speak back.
export const SPEECH_ENABLED = false;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * No full stops in a dictated remark. Every pause starts a new "turn" and each
 * turn comes back closed with a full stop, so "paper solving … and also …
 * adding the new feature" arrived as "Paper solving. And also. Adding the new
 * feature". A remark is a note, not prose, so the stops go and the word after
 * each one drops to lower case — unless it is "I" or an abbreviation like IB,
 * which stay as spoken. Decimals ("2.5 hours") are left alone: only a full stop
 * followed by a space or the end counts.
 */
function unpunctuate(text: string) {
  return text
    .replace(/\.+(\s+)([A-Z])([a-z])/g, (_m, sp, a, b) => sp + a.toLowerCase() + b)
    .replace(/\.+(?=\s|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Dictated text is added to whatever is already typed, not thrown over it. */
export function appendSpoken(existing: string | undefined | null, spoken: string) {
  const had = (existing || '').trim();
  if (!spoken) return had;
  return had ? `${had} ${spoken}` : spoken;
}

// Runs on the audio thread: hands each block of samples back to the page.
const WORKLET = `
class TapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('mic-tap', TapProcessor);
`;

/** Browser audio is -1..1 floats; the API wants signed 16-bit samples. */
function toPcm16(floats: Float32Array) {
  const out = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Speak instead of typing. Press the mic and talk — the words land in the field
 * as they are recognised; press stop when done. Nothing is recorded or stored:
 * the audio is streamed, transcribed and gone.
 *
 * The button owns writing into the field (`value` + `onChange`) because it has
 * to keep rewriting the same tail of text as the wording is corrected mid-
 * sentence. Whatever was already typed when recording started is left alone.
 */
export function DictateButton({
  value,
  onChange,
  disabled,
  label = 'Speak',
}: {
  value: string | undefined | null;
  onChange: (next: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const base = useRef('');                         // what was typed before we started
  const turns = useRef(new Map<number, string>()); // turn number → its latest wording
  const pending = useRef<Int16Array[]>([]);        // samples captured before the socket opened
  const stopping = useRef(false);

  function teardown() {
    try { stream.current?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    try { ctx.current?.close(); } catch { /* already closed */ }
    try { ws.current?.close(); } catch { /* already closed */ }
    stream.current = null;
    ctx.current = null;
    ws.current = null;
    pending.current = [];
  }

  function stop() {
    stopping.current = true;
    setRecording(false);
    // Terminate finalises the open turn, so the last words still arrive before
    // the socket closes.
    try {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'Terminate' }));
    } catch { /* already gone */ }
    try { stream.current?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    setTimeout(teardown, 1500);
  }

  // The clock, which also calls time on a session left running.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Leaving the page mid-sentence must not leave the microphone on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => teardown(), []);

  /** Everything said so far, in the order it was said. */
  function spokenSoFar() {
    return [...turns.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t.trim())
      .filter(Boolean)
      .join(' ');
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      return toast('This browser cannot record audio.', 'error');
    }
    if (window.isSecureContext === false) {
      return toast('Speaking needs a secure (https) page.', 'error');
    }
    setConnecting(true);
    base.current = (value || '').trim();
    turns.current = new Map();
    pending.current = [];
    stopping.current = false;

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setConnecting(false);
      return toast('Microphone blocked — allow access in the browser, then try again.', 'error');
    }

    try {
      // 16 kHz is what we ask for; some browsers ignore it, so the rate we
      // actually get is the one we tell the API — a mismatch garbles the audio.
      const audio = new AudioContext({ sampleRate: WANT_SAMPLE_RATE });
      ctx.current = audio;
      const rate = audio.sampleRate;

      const { data } = await api.get('/speech/token');
      const qs = new URLSearchParams({
        sample_rate: String(Math.round(rate)),
        encoding: 'pcm_s16le',
        speech_model: SPEECH_MODEL,
        format_turns: 'true',
        token: data.token,
      });
      const sock = new WebSocket(`${WS_URL}?${qs}`);
      sock.binaryType = 'arraybuffer';
      ws.current = sock;

      sock.onopen = () => {
        pending.current.forEach((c) => sock.send(c));
        pending.current = [];
        setConnecting(false);
        setSeconds(0);
        setRecording(true);
      };
      sock.onmessage = (e) => {
        let m: any;
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.type !== 'Turn') return;
        // A turn is re-sent as it is heard better, and once more when it is
        // punctuated, so the latest wording replaces the earlier one.
        turns.current.set(m.turn_order ?? 0, String(m.transcript || ''));
        onChange(appendSpoken(base.current, unpunctuate(spokenSoFar())));
      };
      sock.onerror = () => { if (!stopping.current) toast('Speech to text disconnected.', 'error'); };
      sock.onclose = (e) => {
        if (!stopping.current && e.code !== 1000) {
          toast(e.reason || 'Speech to text disconnected.', 'error');
        }
        setRecording(false);
        setConnecting(false);
        teardown();
      };

      // Send the mic in ~100 ms slices, holding anything captured before open.
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await audio.audioWorklet.addModule(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const tap = new AudioWorkletNode(audio, 'mic-tap');
      const perChunk = Math.round((rate * CHUNK_MS) / 1000);
      let buf: number[] = [];
      tap.port.onmessage = (ev: MessageEvent) => {
        buf = buf.concat(Array.from(ev.data as Float32Array));
        while (buf.length >= perChunk) {
          const slice = toPcm16(Float32Array.from(buf.splice(0, perChunk)));
          if (sock.readyState === WebSocket.OPEN) sock.send(slice);
          else if (sock.readyState === WebSocket.CONNECTING) pending.current.push(slice);
        }
      };
      audio.createMediaStreamSource(stream.current).connect(tap);
      // Zero gain so the graph keeps running without playing the mic back.
      const mute = audio.createGain();
      mute.gain.value = 0;
      tap.connect(mute).connect(audio.destination);
    } catch (e: any) {
      setConnecting(false);
      teardown();
      toast(e?.response?.data?.error || 'Could not start speech to text.', 'error');
    }
  }

  if (!SPEECH_ENABLED) return null;

  if (connecting) {
    return (
      <span className="inline-flex items-center gap-1 text-xs muted">
        <Loader2 size={13} className="animate-spin" /> Starting…
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={recording ? stop : start}
      title={recording ? 'Stop' : 'Speak instead of typing'}
      className={
        recording
          ? 'inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-1 bg-red-500/10 text-red-500'
          : 'inline-flex items-center gap-1 text-xs muted rounded-lg px-2 py-1 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
      }
    >
      {recording ? (
        <>
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <Square size={11} className="fill-current" /> Stop {mmss(seconds)}
        </>
      ) : (
        <>
          <Mic size={13} /> {label}
        </>
      )}
    </button>
  );
}
