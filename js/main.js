// ============================================================================
//  main.js  —  Orquestra a interface: upload, worker de IA, player sincronizado,
//  edição/renomeação de locutores, exportação e a limpeza de segurança.
// ============================================================================

import { fileToPcm, isSupported, fmtTime } from "./audio.js";
import { buildParagraphs, detectSpeakers, colorFor } from "./diarization.js";
import { toTXT, toSRT, downloadText } from "./export.js";

// ---------------------------------------------------------------------------
//  Estado — vive APENAS na memória desta aba. Nada é gravado em disco,
//  localStorage, IndexedDB ou servidor. É descartado ao fechar/atualizar.
// ---------------------------------------------------------------------------
const state = {
  file: null,
  blobUrl: null,
  pcm: null,
  duration: 0,
  words: [],
  segments: [],
  paragraphs: [],
  speakerOrder: [],
  names: {},        // { speakerId: "Nome" }
  meta: {},
};

const WHISPER_LABELS = {
  "onnx-community/whisper-base_timestamped": "whisper-base",
  "Xenova/whisper-tiny": "whisper-tiny",
  "onnx-community/whisper-small": "whisper-small",
};

const $ = (sel) => document.querySelector(sel);
const el = {
  drop: $("#dropzone"),
  fileInput: $("#fileInput"),
  fileName: $("#fileName"),
  controls: $("#controls"),
  modelSel: $("#modelSel"),
  langSel: $("#langSel"),
  diarChk: $("#diarChk"),
  runBtn: $("#runBtn"),
  clearBtn: $("#clearBtn"),
  status: $("#status"),
  progressWrap: $("#progressWrap"),
  progressBar: $("#progressBar"),
  progressLabel: $("#progressLabel"),
  playerWrap: $("#playerWrap"),
  audio: $("#audio"),
  result: $("#result"),
  speakersPanel: $("#speakersPanel"),
  speakersList: $("#speakersList"),
  transcript: $("#transcript"),
  exportBar: $("#exportBar"),
  exportTxt: $("#exportTxt"),
  exportSrt: $("#exportSrt"),
  purgeCache: $("#purgeCache"),
};

// ---------------------------------------------------------------------------
//  Worker de IA
// ---------------------------------------------------------------------------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const useWebGPU = "gpu" in navigator;
const device = useWebGPU ? "webgpu" : "wasm";

worker.addEventListener("message", (e) => handleWorker(e.data));
worker.addEventListener("error", (e) =>
  setStatus("Erro no worker: " + (e.message || "desconhecido"), "error")
);

function handleWorker(msg) {
  switch (msg.status) {
    case "progress": {
      // Download/carregamento de modelo.
      if (msg.file && typeof msg.progress === "number") {
        showProgress(msg.progress, `Baixando modelo (${msg.stage}) — ${msg.file}`);
      }
      break;
    }
    case "loading_models":
      setStatus("Preparando modelos…", "busy");
      showProgress(null, "Carregando modelos na memória…");
      break;
    case "ready":
      hideProgress();
      setStatus("Modelos prontos.", "ok");
      break;
    case "transcribing":
      showProgress(null, "Transcrevendo o áudio com o Whisper…");
      setStatus("Transcrevendo…", "busy");
      break;
    case "diarizing":
      showProgress(null, "Identificando os locutores…");
      setStatus("Identificando locutores…", "busy");
      break;
    case "complete":
      onComplete(msg);
      break;
    case "error":
      hideProgress();
      setStatus("Erro: " + msg.message, "error");
      setBusy(false);
      break;
  }
}

// ---------------------------------------------------------------------------
//  Upload
// ---------------------------------------------------------------------------
el.drop.addEventListener("click", () => el.fileInput.click());
el.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.drop.classList.add("drag");
});
el.drop.addEventListener("dragleave", () => el.drop.classList.remove("drag"));
el.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  el.drop.classList.remove("drag");
  if (e.dataTransfer.files?.[0]) loadFile(e.dataTransfer.files[0]);
});
el.fileInput.addEventListener("change", (e) => {
  if (e.target.files?.[0]) loadFile(e.target.files[0]);
});

function loadFile(file) {
  if (!isSupported(file)) {
    setStatus("Formato não suportado. Use mp3, wav, m4a, ogg, flac, webm ou mp4.", "error");
    return;
  }
  // Limpa qualquer áudio anterior antes de carregar o novo.
  resetMedia();
  state.file = file;
  state.blobUrl = URL.createObjectURL(file);
  el.audio.src = state.blobUrl;
  el.fileName.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  el.controls.hidden = false;
  el.playerWrap.hidden = false;
  el.result.hidden = true;
  setStatus("Arquivo pronto. Clique em “Transcrever”.", "ok");
}

// ---------------------------------------------------------------------------
//  Transcrição
// ---------------------------------------------------------------------------
el.runBtn.addEventListener("click", run);

async function run() {
  if (!state.file) return;
  setBusy(true);
  try {
    showProgress(null, "Processando o áudio no seu navegador…");
    const { pcm, duration } = await fileToPcm(state.file, (s) => showProgress(null, s));
    state.pcm = pcm;
    state.duration = duration;

    worker.postMessage(
      {
        type: "run",
        audio: pcm,
        whisperId: el.modelSel.value,
        device,
        language: el.langSel.value,
        withDiarization: el.diarChk.checked,
      },
      [pcm.buffer] // transfere o buffer (sem cópia) para o worker
    );
    // pcm foi transferido; soltamos a referência local.
    state.pcm = null;
  } catch (err) {
    hideProgress();
    setStatus("Erro: " + (err.message || err), "error");
    setBusy(false);
  }
}

function onComplete(msg) {
  state.words = msg.words || [];
  state.segments = msg.segments || [];
  state.paragraphs = buildParagraphs(state.words, state.segments);
  state.speakerOrder = detectSpeakers(state.paragraphs);

  // Nomes padrão para cada locutor (preserva nomes já editados).
  const hasDiar = state.segments.length > 0;
  if (hasDiar) {
    state.speakerOrder.forEach((id) => {
      if (state.names[id] == null) state.names[id] = `Locutor ${id + 1}`;
    });
  }

  state.meta = {
    fileName: state.file?.name,
    date: new Date().toLocaleString("pt-BR"),
    model: WHISPER_LABELS[el.modelSel.value] || el.modelSel.value,
    language: el.langSel.value === "auto" ? "detecção automática" : el.langSel.value,
    duration: state.duration,
  };

  renderSpeakers(hasDiar);
  renderTranscript(hasDiar);
  el.result.hidden = false;
  el.exportBar.hidden = false;
  hideProgress();
  setStatus(
    `Concluído — ${state.paragraphs.length} blocos` +
      (hasDiar ? `, ${state.speakerOrder.length} locutor(es).` : "."),
    "ok"
  );
  setBusy(false);
}

// ---------------------------------------------------------------------------
//  Renderização da transcrição
// ---------------------------------------------------------------------------
function renderTranscript(hasDiar) {
  el.transcript.innerHTML = "";
  state.paragraphs.forEach((p, i) => {
    const block = document.createElement("div");
    block.className = "para";
    block.dataset.idx = i;
    block.dataset.start = p.start;
    block.dataset.end = p.end;

    const meta = document.createElement("div");
    meta.className = "para-meta";

    const ts = document.createElement("button");
    ts.className = "ts";
    ts.type = "button";
    ts.textContent = fmtTime(p.start);
    ts.title = "Pular para este trecho";
    ts.addEventListener("click", () => seekTo(p.start));
    meta.appendChild(ts);

    if (hasDiar) {
      const tag = document.createElement("span");
      tag.className = "spk-tag";
      tag.dataset.speaker = p.speaker;
      const c = colorFor(p.speaker, state.speakerOrder);
      tag.style.setProperty("--spk", c);
      tag.textContent = state.names[p.speaker] ?? `Locutor ${p.speaker + 1}`;
      meta.appendChild(tag);
    }

    const text = document.createElement("p");
    text.className = "para-text";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.textContent = p.text;
    text.addEventListener("input", () => {
      state.paragraphs[i].text = text.textContent;
    });

    block.appendChild(meta);
    block.appendChild(text);
    el.transcript.appendChild(block);
  });
}

// ---------------------------------------------------------------------------
//  Painel de locutores: renomear e mesclar
// ---------------------------------------------------------------------------
function renderSpeakers(hasDiar) {
  el.speakersPanel.hidden = !hasDiar;
  if (!hasDiar) return;
  el.speakersList.innerHTML = "";

  state.speakerOrder.forEach((id) => {
    const row = document.createElement("div");
    row.className = "spk-row";

    const dot = document.createElement("span");
    dot.className = "spk-dot";
    dot.style.background = colorFor(id, state.speakerOrder);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "spk-input";
    input.value = state.names[id] ?? `Locutor ${id + 1}`;
    input.addEventListener("input", () => {
      state.names[id] = input.value;
      // Atualiza as etiquetas já desenhadas, sem redesenhar tudo.
      document
        .querySelectorAll(`.spk-tag[data-speaker="${id}"]`)
        .forEach((t) => (t.textContent = input.value));
    });

    // Mesclar este locutor em outro (corrige erros de diarização).
    const merge = document.createElement("select");
    merge.className = "spk-merge";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "mesclar em…";
    merge.appendChild(opt0);
    state.speakerOrder
      .filter((other) => other !== id)
      .forEach((other) => {
        const o = document.createElement("option");
        o.value = other;
        o.textContent = state.names[other] ?? `Locutor ${other + 1}`;
        merge.appendChild(o);
      });
    merge.addEventListener("change", () => {
      if (merge.value === "") return;
      mergeSpeakers(id, Number(merge.value));
    });

    row.append(dot, input, merge);
    el.speakersList.appendChild(row);
  });
}

function mergeSpeakers(fromId, intoId) {
  state.paragraphs.forEach((p) => {
    if (p.speaker === fromId) p.speaker = intoId;
  });
  // Recombina parágrafos adjacentes que agora têm o mesmo locutor.
  const merged = [];
  for (const p of state.paragraphs) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === p.speaker) {
      last.text = (last.text + " " + p.text).trim();
      last.end = p.end;
    } else {
      merged.push({ ...p });
    }
  }
  state.paragraphs = merged;
  state.speakerOrder = detectSpeakers(state.paragraphs);
  renderSpeakers(true);
  renderTranscript(true);
}

// ---------------------------------------------------------------------------
//  Player sincronizado
// ---------------------------------------------------------------------------
function seekTo(t) {
  el.audio.currentTime = t;
  el.audio.play();
}

el.audio.addEventListener("timeupdate", () => {
  const t = el.audio.currentTime;
  const blocks = el.transcript.querySelectorAll(".para");
  let active = null;
  blocks.forEach((b) => {
    const s = parseFloat(b.dataset.start);
    const e = parseFloat(b.dataset.end);
    const isActive = t >= s && t <= e;
    b.classList.toggle("active", isActive);
    if (isActive) active = b;
  });
  if (active) {
    const r = active.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 40) {
      active.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
});

// ---------------------------------------------------------------------------
//  Exportação
// ---------------------------------------------------------------------------
el.exportTxt.addEventListener("click", () => {
  const txt = toTXT(state.paragraphs, state.names, state.meta);
  downloadText(baseName() + ".txt", txt);
});
el.exportSrt.addEventListener("click", () => {
  const srt = toSRT(state.paragraphs, state.names);
  downloadText(baseName() + ".srt", srt);
});
function baseName() {
  const n = state.file?.name?.replace(/\.[^.]+$/, "") || "transcricao";
  return n + "-transcricao";
}

// ---------------------------------------------------------------------------
//  Limpeza / segurança
// ---------------------------------------------------------------------------
el.clearBtn.addEventListener("click", () => {
  resetMedia();
  state.words = [];
  state.segments = [];
  state.paragraphs = [];
  state.speakerOrder = [];
  state.names = {};
  el.controls.hidden = true;
  el.playerWrap.hidden = true;
  el.result.hidden = true;
  el.exportBar.hidden = true;
  el.fileName.textContent = "";
  el.fileInput.value = "";
  setStatus("Tudo apagado. Nada permaneceu salvo.", "ok");
});

function resetMedia() {
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }
  el.audio.pause();
  el.audio.removeAttribute("src");
  el.audio.load();
  state.file = null;
  state.pcm = null;
}

// Apaga o cache de PESOS DOS MODELOS (não há dados do usuário aqui).
el.purgeCache.addEventListener("click", async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    setStatus("Cache de modelos apagado. Serão baixados novamente no próximo uso.", "ok");
  } catch {
    setStatus("Não foi possível apagar o cache.", "error");
  }
});

// Garante que tudo é descartado ao sair/atualizar a página.
function wipe() {
  resetMedia();
}
window.addEventListener("pagehide", wipe);
window.addEventListener("beforeunload", wipe);

// ---------------------------------------------------------------------------
//  UI helpers
// ---------------------------------------------------------------------------
function setStatus(text, kind = "") {
  el.status.textContent = text;
  el.status.className = "status " + kind;
}
function setBusy(b) {
  el.runBtn.disabled = b;
  el.runBtn.textContent = b ? "Processando…" : "Transcrever";
}
function showProgress(pct, label) {
  el.progressWrap.hidden = false;
  el.progressLabel.textContent = label || "";
  if (pct == null) {
    el.progressBar.classList.add("indeterminate");
    el.progressBar.style.width = "100%";
  } else {
    el.progressBar.classList.remove("indeterminate");
    el.progressBar.style.width = Math.max(2, Math.min(100, pct)) + "%";
  }
}
function hideProgress() {
  el.progressWrap.hidden = true;
  el.progressBar.classList.remove("indeterminate");
  el.progressBar.style.width = "0%";
}

// Mostra qual backend será usado (informativo).
setStatus(
  useWebGPU
    ? "Pronto. Aceleração WebGPU disponível neste navegador."
    : "Pronto. Rodando em WebAssembly (mais lento — Chrome/Edge usam WebGPU).",
  "ok"
);
