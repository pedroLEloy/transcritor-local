// ============================================================================
//  worker.js  —  Toda a inferência de IA roda AQUI, dentro do navegador.
//
//  - Transcrição: OpenAI Whisper (pesos abertos, MIT) via Transformers.js/ONNX
//  - Diarização (quem fala quando): pyannote-segmentation-3.0 (ONNX)
//
//  Nada é enviado para nenhum servidor. Os modelos são baixados uma vez do
//  Hugging Face e ficam em cache no navegador; o ÁUDIO do usuário nunca sai
//  desta aba — ele chega aqui como Float32Array e é descartado ao terminar.
// ============================================================================

import {
  pipeline,
  AutoProcessor,
  AutoModelForAudioFrameClassification,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.6.1";

// Nunca procurar modelos locais; sempre buscar no Hub e cachear no navegador.
env.allowLocalModels = false;
env.useBrowserCache = true;

const SEG_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

let transcriber = null;       // pipeline de ASR (Whisper)
let segModel = null;          // modelo de segmentação de locutores
let segProcessor = null;      // pré/pós-processador da diarização
let loadedWhisperId = null;   // qual modelo Whisper está carregado
let loadedDevice = null;      // 'webgpu' | 'wasm'

function post(msg) {
  self.postMessage(msg);
}

// Carrega (ou reaproveita) os modelos necessários.
async function ensureModels(whisperId, device, withDiarization) {
  // ---- Whisper ----
  if (transcriber === null || loadedWhisperId !== whisperId || loadedDevice !== device) {
    transcriber = null; // libera o anterior para o GC
    const options = {
      // Em GPU usamos quantização leve no decoder; em WASM ficamos em fp32/q8.
      dtype:
        device === "webgpu"
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : { encoder_model: "fp32", decoder_model_merged: "q8" },
      device,
      progress_callback: (p) => post({ status: "progress", stage: "whisper", ...p }),
    };
    transcriber = await pipeline("automatic-speech-recognition", whisperId, options);
    loadedWhisperId = whisperId;
    loadedDevice = device;
  }

  // ---- Diarização (opcional) ----
  if (withDiarization && (segModel === null || segProcessor === null)) {
    segProcessor = await AutoProcessor.from_pretrained(SEG_MODEL_ID, {
      progress_callback: (p) => post({ status: "progress", stage: "diar", ...p }),
    });
    segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG_MODEL_ID, {
      progress_callback: (p) => post({ status: "progress", stage: "diar", ...p }),
    });
  }
}

// Executa o pipeline completo sobre o PCM (Float32Array, mono, 16 kHz).
async function run({ audio, whisperId, device, language, withDiarization }) {
  post({ status: "loading_models" });
  await ensureModels(whisperId, device, withDiarization);

  // ---- 1) Transcrição com timestamps por palavra ----
  post({ status: "transcribing" });
  const asrOptions = {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (language && language !== "auto") asrOptions.language = language;

  const asr = await transcriber(audio, asrOptions);
  // asr.chunks = [{ text, timestamp: [inicio, fim] }, ...]  (uma palavra por item)
  const words = (asr.chunks || [])
    .filter((c) => Array.isArray(c.timestamp))
    .map((c) => ({
      text: c.text,
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0],
    }));

  // ---- 2) Diarização (quem fala quando) ----
  let segments = [];
  if (withDiarization) {
    post({ status: "diarizing" });
    const inputs = await segProcessor(audio);
    const { logits } = await segModel(inputs);
    // post_process devolve [{ id, start, end, confidence }] com tempos em segundos.
    const result = segProcessor.post_process_speaker_diarization(logits, audio.length);
    segments = (result?.[0] || []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      confidence: s.confidence,
    }));
  }

  post({
    status: "complete",
    words,
    segments,
    fullText: asr.text || words.map((w) => w.text).join(""),
  });
}

self.addEventListener("message", async (e) => {
  const data = e.data;
  try {
    if (data.type === "run") {
      await run(data);
    } else if (data.type === "warmup") {
      // Pré-carrega os modelos sem áudio, só para baixar/cachear.
      post({ status: "loading_models" });
      await ensureModels(data.whisperId, data.device, data.withDiarization);
      post({ status: "ready" });
    }
  } catch (err) {
    post({ status: "error", message: String(err?.message || err) });
  }
});
