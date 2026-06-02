// ============================================================================
//  diarization.js  —  Combina a saída do Whisper (palavras + timestamps) com a
//  saída do pyannote (faixas de locutor) e produz blocos de parágrafo prontos
//  para exibição e exportação.
// ============================================================================

// Para cada palavra, descobre qual locutor estava falando no instante dela.
function speakerForWord(word, segments) {
  if (!segments.length) return null;
  const mid = (word.start + word.end) / 2;

  // 1) Segmento que contém o ponto médio da palavra.
  for (const seg of segments) {
    if (mid >= seg.start && mid <= seg.end) return seg.id;
  }
  // 2) Caso caia num silêncio entre segmentos: pega o mais próximo.
  let best = segments[0];
  let bestDist = Infinity;
  for (const seg of segments) {
    const d = mid < seg.start ? seg.start - mid : mid - seg.end;
    if (d < bestDist) {
      bestDist = d;
      best = seg;
    }
  }
  return best.id;
}

// Junta unidades consecutivas (palavras OU trechos) do mesmo locutor em
// parágrafos. `granularity` indica se as unidades são "word" (concatenadas sem
// espaço extra, pois o token já traz o espaço inicial) ou "segment" (juntadas
// com espaço). Quebra também em pausas longas (> gapSplit).
export function buildParagraphs(units, segments, { gapSplit = 8, granularity = "word" } = {}) {
  const hasDiar = segments && segments.length > 0;
  const joiner = granularity === "segment" ? " " : "";
  const paragraphs = [];
  let current = null;

  for (const u of units) {
    const spk = hasDiar ? speakerForWord(u, segments) : 0;

    const speakerChanged = current && current.speaker !== spk;
    const bigGap = current && u.start - current.end > gapSplit;

    if (!current || speakerChanged || (!hasDiar && bigGap)) {
      if (current) paragraphs.push(current);
      current = { speaker: spk, start: u.start, end: u.end, text: u.text };
    } else {
      current.text += joiner + u.text;
      current.end = u.end;
    }
  }
  if (current) paragraphs.push(current);

  // Limpa espaços duplicados e bordas de cada parágrafo.
  for (const p of paragraphs) p.text = p.text.replace(/\s+/g, " ").trim();
  return paragraphs.filter((p) => p.text.length > 0);
}

// Lista de IDs de locutor presentes (ordenados pela 1ª aparição).
export function detectSpeakers(paragraphs) {
  const seen = [];
  for (const p of paragraphs) {
    if (!seen.includes(p.speaker)) seen.push(p.speaker);
  }
  return seen;
}

// Paleta de cores para diferenciar locutores na tela.
export const SPEAKER_PALETTE = [
  "#e08a3c", "#5aa9e6", "#7cc36b", "#d96a8f",
  "#b08bd9", "#e0c14a", "#56c4c0", "#e07a5f",
];

export function colorFor(speakerId, order) {
  const idx = order.indexOf(speakerId);
  return SPEAKER_PALETTE[(idx >= 0 ? idx : speakerId) % SPEAKER_PALETTE.length];
}
