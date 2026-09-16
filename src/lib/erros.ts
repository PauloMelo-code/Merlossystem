/**
 * Erros tipados e o resultado único das actions (03-arquitetura.md §14,
 * 01-dados.md §13.3, 04-ui.md §7.2).
 *
 * O `codigo` é contrato fechado com a tela: cada valor tem um comportamento
 * escrito em 04-ui.md §7.2. Não invente código novo sem atualizar aquela
 * tabela — a UI cai no texto genérico e a pessoa fica sem saída.
 */

export type Resultado<T> =
  | { ok: true; dados: T }
  | {
      ok: false;
      codigo: string;
      mensagem: string;
      erros?: Record<string, string[]>; // Zod devolve lista
      valores?: Record<string, string>; // o formulário nunca é limpo
    };

/**
 * Raiz de todo erro que a aplicação lança de propósito. Quem estende declara
 * `codigo` (o contrato com a tela) e `status` (o que o Route Handler responde).
 * O portão de `src/lib/auth/guard.ts` estende esta classe para `NAO_AUTENTICADO`,
 * `SESSAO_NAO_FRESCA`, `TROCA_OBRIGATORIA` e `FATOR_OBRIGATORIO`.
 */
export class ErroDoAplicativo extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, mensagem: string, status: number) {
    super(mensagem);
    this.name = new.target.name;
    this.codigo = codigo;
    this.status = status;
  }
}

/** Zod recusou a entrada. `campos` vira `erros` no `Resultado`. */
export class ErroDeValidacao extends ErroDoAplicativo {
  readonly campos: Record<string, string[]>;
  readonly valores: Record<string, string> | undefined;

  constructor(
    campos: Record<string, string[]>,
    valores?: Record<string, string>,
    mensagem = "Confira os campos destacados.",
  ) {
    super("VALIDACAO", mensagem, 400);
    this.campos = campos;
    this.valores = valores;
  }
}

/**
 * `atualizarComTrava` voltou zero linhas: alguém gravou entre a leitura e a
 * escrita. Nunca sobrescrever em silêncio (01-dados.md §4.7).
 */
export class ErroDeColisao extends ErroDoAplicativo {
  readonly porQuem: string | undefined;
  readonly quando: Date | undefined;

  constructor(porQuem?: string, quando?: Date) {
    super(
      "COLISAO",
      "Este registro foi alterado por outra pessoa. Suas alterações não foram salvas; o que você digitou continua aqui.",
      409,
    );
    this.porQuem = porQuem;
    this.quando = quando;
  }
}

/** `exigirPermissao()` recusou. Quem lança já gravou `recusa_403` na trilha. */
export class ErroDePermissao extends ErroDoAplicativo {
  constructor(mensagem = "Você não tem acesso a esta ação. Fale com o administrador.") {
    super("SEM_PERMISSAO", mensagem, 403);
  }
}

/**
 * O registro existe, mas é de outra loja. Responde **404**, nunca 403: confirmar
 * que existe já entrega a informação que o escopo de loja esconde.
 */
export class ErroDeEscopo extends ErroDoAplicativo {
  constructor(mensagem = "Registro não encontrado.") {
    super("NAO_ENCONTRADO", mensagem, 404);
  }
}

/** `lojaParaGravar()` sem loja resolvida: gestão precisa escolher uma. */
export class ErroFaltaLoja extends ErroDoAplicativo {
  constructor(mensagem = "Escolha uma loja no topo da tela para continuar.") {
    super("FALTA_LOJA", mensagem, 409);
  }
}

/**
 * Canal, Bling ou provedor de e-mail recusou. `permanente` decide se a fila
 * retenta e se a tela oferece "Tentar de novo" (03-arquitetura.md §8.2).
 */
export class ErroDeIntegracao extends ErroDoAplicativo {
  readonly permanente: boolean;

  constructor(mensagem: string, permanente: boolean) {
    super("INTEGRACAO", mensagem, 502);
    this.permanente = permanente;
  }
}

/** Falta variável de ambiente ou a chave do cofre não abre: 503, nunca 500. */
export class ErroDeConfiguracao extends ErroDoAplicativo {
  constructor(
    mensagem = "O sistema está sem uma configuração necessária. Avise o administrador.",
  ) {
    super("CONFIGURACAO", mensagem, 503);
  }
}

/**
 * Costura de pacote ainda não preenchida (05-plano-construcao.md §5). A
 * fundação cria o arquivo com a assinatura final para tudo compilar desde o
 * dia 1; o pacote dono troca o corpo pela implementação. 501 e não 500: é
 * "ainda não existe", não "quebrou".
 */
export class ErroNaoImplementado extends ErroDoAplicativo {
  constructor(oQue: string) {
    super("NAO_IMPLEMENTADO", `Ainda não implementado: ${oQue}.`, 501);
  }
}

/** Devolve o erro para quem chama escrever `throw naoImplementado("…")`. */
export function naoImplementado(oQue: string): ErroNaoImplementado {
  return new ErroNaoImplementado(oQue);
}

/**
 * Traduz a exceção no `Resultado` que a action devolve (§14.2, passo 6 de
 * `executarAcao`). Exceção desconhecida vira mensagem genérica: detalhe de
 * erro interno na tela é superfície de informação de graça.
 */
export function paraResultado(erro: unknown): Extract<Resultado<never>, { ok: false }> {
  if (erro instanceof ErroDeValidacao) {
    return {
      ok: false,
      codigo: erro.codigo,
      mensagem: erro.message,
      erros: erro.campos,
      ...(erro.valores === undefined ? {} : { valores: erro.valores }),
    };
  }
  if (erro instanceof ErroDoAplicativo) {
    return { ok: false, codigo: erro.codigo, mensagem: erro.message };
  }
  return {
    ok: false,
    codigo: "INESPERADO",
    mensagem: "Não foi possível concluir. Tente de novo em instantes.",
  };
}
