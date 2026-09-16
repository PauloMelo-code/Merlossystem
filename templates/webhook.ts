// TEMPLATE — copie para `src/app/api/webhooks/<provedor>/route.ts`.
//
// A ORDEM ABAIXO NAO NEGOCIA (02-seguranca.md secao 12). `rotaDeMaquina()` a
// impoe, e e por isso que ela existe em vez de cada webhook montar a sua:
//
//   1. teto por IP                     (antes de qualquer consulta ao banco)
//   2. teto de tamanho do corpo        (pelo content-length, antes de ler)
//   3. extrair a CHAVE de roteamento   (da URL ou de cabecalho, NUNCA com JSON.parse)
//   4. carregar a integracao           (null para inexistente, revogada ou excluida)
//   5. conferir a assinatura/segredo   (chamado MESMO com integracao nula)
//   6. so agora `JSON.parse`           (dentro de `processar`)
//
// O primeiro `JSON.parse` do fluxo mora dentro de `processar`. Fazer o parse
// antes de autenticar entrega o analisador de JSON para quem nao provou nada.
//
// A rota tambem precisa estar em `src/lib/seguranca/rotas-publicas.ts` e em
// `docs/seguranca/caminhos-de-acesso.md`. Falta em qualquer um dos dois: T2.

import { rotaDeMaquina } from "@/lib/seguranca/maquina";
import { conferirAssinaturaMeta } from "@/lib/seguranca/assinaturas";
import { TETO_WEBHOOK } from "@/lib/seguranca/corpo";

type CargaExemplo = { entry?: unknown[] };

export const POST = rotaDeMaquina<CargaExemplo>({
  provedor: "whatsapp_oficial",

  // Tetos independentes: o de IP segura a rajada de um endereco; o de
  // integracao segura o provedor que enlouqueceu com UMA conta.
  limiteIp: { janela: 60, max: 600 },
  limiteIntegracao: { janela: 60, max: 300 },
  maxBytes: TETO_WEBHOOK,

  /** Da URL ou de cabecalho. Nunca do corpo: o corpo ainda nao foi conferido. */
  chave: (req) => req.headers.get("x-conta-externa"),

  /**
   * `null` para inexistente, revogada, excluida ou sem loja. O wrapper trata
   * os quatro IGUAL — responder diferente para "nao existe" e "assinatura
   * errada" entrega o mapa de contas para quem esta sondando.
   */
  carregar: async (chave) => {
    throw new Error(`carregue a integracao de ${String(chave)}`);
  },

  /**
   * Chamado MESMO com `integracao === null`: e isso que iguala o tempo das
   * duas recusas. `conferirAssinaturaMeta` queima um hash fixo quando nao ha
   * segredo, e compara em tempo constante.
   */
  conferir: (corpoCru, req, integracao) =>
    conferirAssinaturaMeta(corpoCru, req.headers.get("x-hub-signature-256"), integracao),

  /**
   * Aqui, e so aqui, o corpo vira objeto. `processar` recebe
   * `{ req, corpoCru, integracao, ip }` e devolve a `Response`.
   *
   * O handler PERSISTE o evento cru em `lojas_integracoes_eventos` e devolve
   * 200. O trabalho de verdade e da fila (`mensagens-entrada`): processar
   * dentro da requisicao faz o provedor reentregar quando o processamento
   * demora, e a mesma mensagem chega duas vezes.
   *
   * Falha ao PERSISTIR = deixe a excecao subir (500, o provedor reentrega).
   * Falha ao PROCESSAR = 200, porque a linha ja esta salva e a fila retenta.
   */
  processar: async ({ corpoCru, integracao }) => {
    const carga = JSON.parse(corpoCru) as CargaExemplo;
    void carga;
    void integracao;
    throw new Error("persista o evento e enfileire mensagens-entrada/processar-evento");
  },

  /**
   * Opcional: o GET de verificacao do provedor (`hub.challenge`). Token de
   * challenge PROPRIO por canal — compartilhar um token entre WhatsApp e
   * Instagram foi falha do sistema antigo.
   */
  verificar: (req) => {
    void req;
    return null;
  },
});
