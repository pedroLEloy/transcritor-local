// ============================================================================
//  export.js  —  Geração dos arquivos de saída (TXT formatado e SRT).
// ============================================================================

import { fmtTime, fmtSrt } from "./audio.js";

// TXT com cabeçalho, locutor, timestamp e parágrafos — pronto para leitura.
export function toTXT(paragraphs, names, meta) {
  const lines = [];
  lines.push("TRANSCRIÇÃO");
  lines.push("=".repeat(60));
  if (meta?.fileName) lines.push(`Arquivo:   ${meta.fileName}`);
  if (meta?.date) lines.push(`Gerado em: ${meta.date}`);
  if (meta?.model) lines.push(`Modelo:    ${meta.model} (OpenAI Whisper, local)`);
  if (meta?.language) lines.push(`Idioma:    ${meta.language}`);
  if (meta?.duration != null) lines.push(`Duração:   ${fmtTime(meta.duration)}`);
  lines.push("=".repeat(60));
  lines.push("");

  for (const p of paragraphs) {
    const name = names?.[p.speaker] ?? `Locutor ${p.speaker + 1}`;
    const hasSpeaker = p.speaker !== null && p.speaker !== undefined;
    const header = hasSpeaker
      ? `[${fmtTime(p.start)}] ${name}:`
      : `[${fmtTime(p.start)}]`;
    lines.push(header);
    lines.push(p.text);
    lines.push("");
  }
  return lines.join("\n");
}

// SRT (legendas) — uma entrada por parágrafo, com prefixo de locutor.
export function toSRT(paragraphs, names) {
  const out = [];
  paragraphs.forEach((p, i) => {
    const name = names?.[p.speaker];
    const prefix = name ? `[${name}] ` : "";
    out.push(String(i + 1));
    out.push(`${fmtSrt(p.start)} --> ${fmtSrt(p.end)}`);
    out.push(prefix + p.text);
    out.push("");
  });
  return out.join("\n");
}

// Dispara o download de um texto como arquivo, sem nada tocar servidor.
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga logo em seguida — o arquivo só existiu na memória durante o clique.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
