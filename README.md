# Transcritor Local

Transcrição de áudio e vídeo com **identificação de locutores**, **timestamps** e
**exportação em TXT/SRT** — rodando **100% dentro do navegador**.

O motor é o **Whisper da OpenAI** (pesos abertos, licença MIT) executado via
[Transformers.js](https://github.com/huggingface/transformers.js) sobre ONNX
Runtime Web. A diarização (quem fala quando) usa o modelo
`pyannote-segmentation-3.0`. **Nenhum arquivo é enviado a servidores.**

---

## Funcionalidades

- Upload por arrastar-e-soltar ou seletor de arquivos
- Formatos: `mp3`, `wav`, `m4a`, `aac`, `ogg`, `flac`, `webm` e a faixa de áudio de `mp4`
- Transcrição multilíngue (100+ idiomas) com detecção automática ou idioma fixo
- Identificação de locutores + **renomear** e **mesclar** locutores manualmente
- Marcações de tempo por bloco, com **player sincronizado** (clique no horário para ouvir)
- Edição do texto direto na tela antes de exportar
- Exportação em **TXT formatado** (cabeçalho, locutor, timestamp, parágrafos) e **SRT**
- Escolha de modelo: `tiny` (rápido) · `base` (recomendado) · `small` (mais preciso)
- Aceleração por **WebGPU** quando disponível (Chrome/Edge); senão, WebAssembly

## Privacidade e segurança

- **Processamento local:** o áudio é decodificado e transcrito no próprio
  navegador. Ele nunca trafega para nenhum backend — não há backend.
- **Nada persiste:** áudio e transcrição vivem só na memória da aba (e numa
  URL temporária `blob:` para o player). Ao **fechar ou atualizar** a página,
  tudo é descartado (`pagehide`/`beforeunload` revogam os blobs e limpam o estado).
  Não há uso de `localStorage`, `IndexedDB` nem cookies para dados do usuário.
- **Cache apenas de modelos:** os pesos do Whisper/pyannote ficam no Cache API do
  navegador para acelerar usos seguintes. Isso **não** são dados seus — e há um
  botão "Limpar cache de modelos" na interface.
- **Cabeçalhos de segurança** (em `vercel.json`): `Content-Security-Policy`
  restritiva, `COOP`/`COEP: credentialless` (habilita multithreading via
  `SharedArrayBuffer`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy` desligando câmera/microfone/etc.,
  e `HSTS`.

## Rodar localmente

É um site estático — precisa de um servidor HTTP (não abra via `file://`,
pois Web Workers de módulo e o WebGPU exigem origem http/https).

```bash
npm run dev      # sobe em http://localhost:3000
# ou simplesmente:
npx serve .
```

> Localmente, sem os cabeçalhos `COOP/COEP`, o ONNX roda **single-thread**
> (mais lento, porém funciona). Em produção no Vercel os cabeçalhos do
> `vercel.json` habilitam o modo multithread automaticamente.

## Deploy no Vercel

1. Suba este repositório no GitHub.
2. No Vercel: **Add New → Project → Import** o repositório.
3. Framework Preset: **Other**. Build Command: *(vazio)*. Output Directory: `./`.
4. Deploy. Os cabeçalhos de `vercel.json` são aplicados automaticamente.

Pela CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # produção
```

## Estrutura

```
transcritor-local/
├── index.html          # interface
├── styles.css          # estilo
├── js/
│   ├── main.js         # orquestra UI, worker, player, segurança
│   ├── worker.js       # Whisper + pyannote (toda a IA, em Web Worker)
│   ├── audio.js        # decodifica e reamostra para 16 kHz mono
│   ├── diarization.js  # alinha palavras a locutores e monta parágrafos
│   └── export.js       # gera TXT e SRT
├── vercel.json         # cabeçalhos de segurança
├── package.json
├── LICENSE
└── README.md
```

## Notas técnicas e limites

- **Primeira execução baixa o modelo** (~150 MB para o `base`, ~50 MB para o
  `tiny`, ~250 MB para o `small`), uma única vez. Depois vem do cache.
- A **diarização é aproximada.** O `pyannote-segmentation-3.0` separa locutores
  muito bem em diálogos de poucos participantes; em gravações longas ou com
  muitas vozes, a separação global pode confundir falantes. Por isso há
  renomear/mesclar manual.
- **Arquivos longos** consomem memória e tempo proporcionalmente. Para reuniões
  longas, prefira o `base` e considere dividir o áudio.
- Se o carregamento do modelo falhar por causa do `COEP`, remova a linha
  `Cross-Origin-Embedder-Policy` do `vercel.json`: a app passa a rodar
  single-thread, sem multithreading, mas funciona.
- Navegadores recomendados: **Chrome/Edge** (WebGPU e `COEP: credentialless`).
  Firefox/Safari funcionam em WebAssembly single-thread.

## Créditos

OpenAI Whisper (MIT) · Hugging Face Transformers.js · pyannote.audio.
Este projeto não é afiliado a essas organizações.
