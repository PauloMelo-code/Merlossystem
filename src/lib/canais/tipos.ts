/**
 * Contrato do adaptador de canal (03-arquitetura.md §10.1).
 *
 * Módulo PURO: só tipos. É lido pelos três adaptadores, pela fábrica
 * (`registro.ts`), pela ingestão e pelos testes de parser.
 *
 * CAPACIDADE = PRESENÇA DO MÉTODO. `enviarModelo` ausente no uazapi impede
 * mandar o nome do template como texto, sem `if (provedor === ...)` espalhado.
 */

export type Canal = "whatsapp" | "instagram";

/**
 * Repete `PROVEDORES` (01-dados.md §16.3). `facebook`, `tiktok_shop` e `bling`
 * NÃO têm adaptador de canal no R1: `criarAdaptador()` lança
 * `ErroDeConfiguracao("provedor não habilitado")`.
 */
export type Provedor =
  | "whatsapp_oficial"
  | "uazapi"
  | "instagram"
  | "facebook"
  | "tiktok_shop"
  | "bling";

export type MidiaRecebida = {
  idExterno?: string;
  url?: string;
  mime?: string;
  nome?: string;
  legenda?: string;
};

/**
 * `tipo` usa os valores de `TIPOS_CONTEUDO` — inclusive `sticker`, que é o que
 * vai ao CHECK do banco. `template` e `sistema` nunca vêm de adaptador.
 */
export type TipoNormalizado =
  | "texto"
  | "imagem"
  | "video"
  | "audio"
  | "documento"
  | "sticker"
  | "localizacao";

export type MensagemNormalizada = {
  contaExterna: string;
  externoId: string;
  remetenteId: string;
  remetenteNome?: string;
  tipo: TipoNormalizado;
  texto?: string;
  /** 1:N — vários anexos com o mesmo id externo viram UMA mensagem com N mídias. */
  midias?: MidiaRecebida[];
  /** Citação (reply): id externo da mensagem citada. */
  respondendoA?: string;
  /** Eco do próprio número (uazapi): é GRAVADO como saída, nunca descartado. */
  deMim: boolean;
  ocorridoEm: Date;
  bruto: unknown;
};

export type StatusRecebido = "enviada" | "entregue" | "lida" | "falhou";

export type AtualizacaoDeStatus = {
  externoId: string;
  status: StatusRecebido;
  motivo?: string;
  ocorridoEm: Date;
};

export type MotivoDescarte = "grupo" | "eco_de_pagina" | "tipo_nao_suportado" | "sem_remetente";

export type EventoDescartado = { motivo: MotivoDescarte; tipoOriginal?: string };

export type EstadoDaSessao = "conectada" | "conectando" | "desconectada";

export type EventoDeSessao = { estado: EstadoDaSessao; qr?: string };

export type InterpretacaoDeWebhook = {
  mensagens: MensagemNormalizada[];
  status: AtualizacaoDeStatus[];
  descartados: EventoDescartado[];
  sessao?: EventoDeSessao;
};

export type LimitesDoCanal = {
  imagemMb: number;
  videoMb: number;
  audioMb: number;
  documentoMb: number;
  textoMax: number;
};

/** Binário, não URL (03-arquitetura.md §13.3). */
export type MidiaParaEnvio = {
  tipo: "imagem" | "video" | "audio" | "documento" | "sticker";
  bytes: Buffer;
  mime: string;
  nome?: string;
  legenda?: string;
};

export type ModeloParaEnvio = {
  nome: string;
  idioma: string;
  variaveis: string[];
};

export type ResultadoEnvio =
  | { ok: true; externoId: string }
  | { ok: false; motivo: string; permanente: boolean };

export interface AdaptadorDeCanal {
  readonly provedor: Provedor;
  readonly limites: LimitesDoCanal;
  /** Meta sim, uazapi não. */
  readonly exigeJanela24h: boolean;
  enviarTexto(destino: string, texto: string): Promise<ResultadoEnvio>;
  enviarMidia?(destino: string, m: MidiaParaEnvio): Promise<ResultadoEnvio>;
  /** Ausente no uazapi. */
  enviarModelo?(destino: string, modelo: ModeloParaEnvio): Promise<ResultadoEnvio>;
  baixarMidia?(ref: string): Promise<{ bytes: Buffer; mime: string }>;
  marcarComoLida?(externoId: string): Promise<void>;
  /** uazapi. */
  estadoDaSessao?(): Promise<{ estado: EstadoDaSessao; qr?: string }>;
  verificarAssinatura(corpoCru: string, cabecalhos: Headers): boolean;
  /** Recebe o corpo CRU e NUNCA lança: payload ilegível devolve listas vazias. */
  interpretarWebhook(corpoCru: string): InterpretacaoDeWebhook;
}

/**
 * O que a fábrica recebe: a conta conectada, com a credencial JÁ decifrada.
 * O adaptador nunca lê `process.env` e não existe fallback de ambiente (A-12).
 */
export type ContaDeCanal = {
  id: string;
  lojaId: string;
  provedor: Provedor;
  referenciaExterna: string | null;
  segredoWebhookHash: string | null;
  credenciais: Readonly<Record<string, string>>;
};

/** Configuração de plataforma que a fábrica lê de `env.ts` e injeta. */
export type ConfigDoCanal = {
  /** `META_GRAPH_VERSION` — sem default literal no código. */
  versaoGraph?: string | undefined;
  /** `UAZAPI_BASE_URL` — o único host uazapi da allowlist de `buscarExterno`. */
  baseUazapi?: string | undefined;
};

/** Porta HTTP injetada: em produção é `rede/buscarExterno.ts`; no teste, um dublê. */
export type ClienteHttp = (
  url: string,
  opcoes: {
    provedor: "meta" | "uazapi";
    metodo?: "GET" | "POST";
    corpo?: string;
    cabecalhos?: Record<string, string>;
  },
) => Promise<{ status: number; tipo: string | null; bytes: Buffer }>;

