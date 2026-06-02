// ============================================================================
//  audio.js  —  Decodificação e reamostragem de áudio (no thread principal).
//
//  Aceita .mp3, .wav, .m4a, .aac, .ogg, .flac, .webm e a faixa de áudio de
//  arquivos .mp4 — tudo via Web Audio API do próprio navegador (sem upload).
//  Converte para o formato que o Whisper espera: mono, 16 kHz, Float32Array.
// ============================================================================

const TARGET_RATE = 16000;

const SUPPORTED_EXT = [
  "mp3", "wav", "m4a", "aac", "ogg", "oga", "opus",
  "flac", "webm", "mp4", "m4v", "mov",
];

export function isSupported(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (SUPPORTED_EXT.includes(ext)) return true;
  return /^audio\//.test(file.type) || /^video\//.test(file.type);
}

// Decodifica o arquivo e devolve { pcm: Float32Array(16k mono), duration }.
export async function fileToPcm(file, onStage) {
  onStage?.("Lendo arquivo…");
  const arrayBuffer = await file.arrayBuffer();

  onStage?.("Decodificando áudio…");
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let audioBuffer;
  try {
    // .slice(0) evita que o ArrayBuffer seja "detached" e possamos reusá-lo.
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    decodeCtx.close();
    throw new Error(
      "Não foi possível decodificar este arquivo neste navegador. " +
      "Tente converter para .wav ou .mp3, ou use o Chrome/Edge."
    );
  }
  const duration = audioBuffer.duration;
  decodeCtx.close();

  onStage?.("Reamostrando para 16 kHz…");
  // OfflineAudioContext com 1 canal -> faz o downmix para mono e reamostra.
  const frames = Math.max(1, Math.ceil(duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0); // Float32Array @ 16 kHz, mono

  return { pcm, duration };
}

// Formata segundos -> "HH:MM:SS" (ou "MM:SS" se < 1h).
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Formato de tempo do SRT: "HH:MM:SS,mmm".
export function fmtSrt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
