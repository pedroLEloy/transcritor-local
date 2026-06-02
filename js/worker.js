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

const LIB_URL = new URL("./vendor/transformers.min.js", import.meta.url).href;
const WASM_PATH = new URL("./vendor/", import.meta.url).href;
const SEG_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

let lib = null;              // módulo Transformers.js (carregado sob demanda)
let transcriber = null;      // pipeline de ASR (Whisper)
let segModel = null;         // modelo de segmentação de locutores
let segProcessor = null;     // pré/pós-processador da diarização
let loadedWhisperId = null;
let loadedDevice = null;

function post(msg) {
  self.postMessage(msg);
}

// Carrega a biblioteca (vendorizada, mesma origem) e configura o runtime ONNX.
async function getLib() {
  if (lib) return lib;
  try {
    lib = await import(LIB_URL);
  } catch (e) {
    throw new Error(
      "Não foi possível carregar a biblioteca de IA local (js/vendor/transformers.min.js). " +
      "Detalhe: " + (e && e.message ? e.message : e)
    );
  }
  lib.env.allowLocalModels = false;     // modelos vêm do Hugging Face Hub
  lib.env.useBrowserCache = true;       // mas ficam em cache local
  // Runtime ONNX servido localmente (sem CDN), single-thread (sem SharedArrayBuffer).
  lib.env.backends.onnx.wasm.wasmPaths = WASM_PATH;
  lib.env.backends.onnx.wasm.numThreads = 1;
  return lib;
}

// Cria o pipeline do Whisper tentando WebGPU e caindo para WASM se falhar.
async function buildTranscriber(whisperId, device) {
  const { pipeline } = await getLib();

  const make = async (dev) => {
    const dtype =
      dev === "webgpu"
        ? { encoder_model: "fp32", decoder_model_merged: "q4" }
        : { encoder_model: "fp32", decoder_model_merged: "q8" };
    return pipeline("automatic-speech-recognition", whisperId, {
      dtype,
      device: dev,
      progress_callback: (p) => post({ status: "progress", stage: "whisper", ...p }),
    });
  };

  try {
    const t = await make(device);
    loadedDevice = device;
    return t;
  } catch (e) {
    if (device === "webgpu") {
      post({ status: "info", message: "WebGPU indisponível; usando WASM." });
      const t = await make("wasm");
      loadedDevice = "wasm";
      return t;
    }
    throw e;
  }
}

async function ensureModels(whisperId, device, withDiarization) {
  if (transcriber === null || loadedWhisperId !== whisperId || loadedDevice == null) {
    transcriber = null;
    transcriber = await buildTranscriber(whisperId, device);
    loadedWhisperId = whisperId;
  }

  if (withDiarization && (segModel === null || segProcessor === null)) {
    const { AutoProcessor, AutoModelForAudioFrameClassification } = await getLib();
    segProcessor = await AutoProcessor.from_pretrained(SEG_MODEL_ID, {
      progress_callback: (p) => post({ status: "progress", stage: "diar", ...p }),
    });
    segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG_MODEL_ID, {
      progress_callback: (p) => post({ status: "progress", stage: "diar", ...p }),
    });
  }
}

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
  const words = (asr.chunks || [])
    .filter((c) => Array.isArray(c.timestamp))
    .map((c) => ({
      text: c.text,
      start: c.timestamp[0],
      end: c.timestamp[1] != null ? c.timestamp[1] : c.timestamp[0],
    }));

  // ---- 2) Diarização (quem fala quando) ----
  let segments = [];
  if (withDiarization) {
    post({ status: "diarizing" });
    const inputs = await segProcessor(audio);
    const { logits } = await segModel(inputs);
    const result = segProcessor.post_process_speaker_diarization(logits, audio.length);
    segments = (result && result[0] ? result[0] : []).map((s) => ({
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
      post({ status: "loading_models" });
      await ensureModels(data.whisperId, data.device, data.withDiarization);
      post({ status: "ready" });
    }
  } catch (err) {
    post({ status: "error", message: String(err && err.message ? err.message : err || "falha desconhecida") });
  }
});

// Captura erros não tratados dentro do worker e os reporta com texto.
self.addEventListener("error", (e) => {
  post({ status: "error", message: e.message || "erro interno do worker" });
});
self.addEventListener("unhandledrejection", (e) => {
  post({ status: "error", message: String((e.reason && e.reason.message) || e.reason || "promessa rejeitada") });
});
