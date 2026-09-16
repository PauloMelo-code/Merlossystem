/**
 * Catálogo dos provedores conectáveis no R1 (03-arquitetura.md §4.1, §11;
 * 04-ui.md §5.6).
 *
 * ÚNICA exceção isomórfica do módulo: constante pura, SEM import nenhum, porque
 * a tela gera os campos do formulário a partir daqui (06/INV-58). Importar o
 * cofre por acidente arrastaria `node:crypto` para o bundle do navegador.
 *
 * `facebook` e `tiktok_shop` continuam no CHECK de `provedor` (custo zero), mas
 * NÃO estão aqui: fora do R1 não existe rota, adaptador nem formulário (S-16).
 */

export const PROVEDORES_CONECTAVEIS = ["whatsapp_oficial", "uazapi", "instagram", "bling"] as const;
export type ProvedorConectavel = (typeof PROVEDORES_CONECTAVEIS)[number];

/** Provedores de CANAL: exigem loja (CHECK `lojas_integracoes_rede`). */
export const PROVEDORES_DE_CANAL = ["whatsapp_oficial", "uazapi", "instagram"] as const;
export type ProvedorDeCanal = (typeof PROVEDORES_DE_CANAL)[number];

export function ehProvedorDeCanal(valor: string): valor is ProvedorDeCanal {
  return (PROVEDORES_DE_CANAL as readonly string[]).includes(valor);
}

/** Conta da REDE (loja nula). Hoje só o Bling, conectado por OAuth. */
export function ehDaRede(provedor: string): boolean {
  return provedor === "bling";
}

export type DescricaoDoProvedor = {
  rotulo: string;
  /** Chaves da credencial, na ordem em que a tela pede. Vazio = OAuth. */
  chaves: readonly string[];
  /** O que é a `referencia_externa`: é por ela que o webhook acha a conta. */
  referencia: { rotulo: string; ajuda: string } | null;
  /** Aviso fixo mostrado junto do formulário. */
  aviso?: string;
};

export const PROVEDORES: Readonly<Record<ProvedorConectavel, DescricaoDoProvedor>> = {
  whatsapp_oficial: {
    rotulo: "WhatsApp oficial (Meta)",
    chaves: ["access_token", "waba_id"],
    referencia: {
      rotulo: "ID do número (phone_number_id)",
      ajuda: "Meta Business > WhatsApp > Configuração da API. É o campo metadata.phone_number_id do webhook.",
    },
  },
  uazapi: {
    rotulo: "WhatsApp não oficial (uazapi)",
    chaves: ["token"],
    referencia: {
      rotulo: "Nome da instância",
      ajuda: "O nome da instância no painel do uazapi.",
    },
    aviso:
      "Número não oficial pode ser banido pelo WhatsApp. O uazapi não usa modelo aprovado e a sessão cai sozinha: fique de olho no status.",
  },
  instagram: {
    rotulo: "Instagram",
    chaves: ["page_access_token"],
    referencia: {
      rotulo: "ID da conta do Instagram",
      ajuda: "ID da conta profissional ligada à página. É o entry.id do webhook da Meta.",
    },
  },
  bling: {
    rotulo: "Bling (conta da rede)",
    chaves: [],
    referencia: null,
    aviso: "O Bling é lido, nunca escrito. A conta é única para a rede; o depósito de cada loja fica no cadastro da loja.",
  },
};

/** Explicação de cada chave, para a tela não virar adivinhação. */
export const AJUDA_DA_CHAVE: Readonly<Record<string, string>> = {
  access_token: "Token permanente do app da Meta. Depois de salvo, só os 4 últimos caracteres aparecem.",
  waba_id: "ID da conta do WhatsApp Business (WABA). É por ele que os modelos são sincronizados.",
  token: "Token da instância no uazapi. Dá acesso total ao número.",
  page_access_token: "Token da página, gerado no app da Meta com permissão de mensagens.",
};

/** Formato das chaves: sem espaço, sem quebra, tamanho de token de verdade. */
export const FORMATO_DA_CHAVE = /^[A-Za-z0-9._\-|:]{4,2048}$/;
