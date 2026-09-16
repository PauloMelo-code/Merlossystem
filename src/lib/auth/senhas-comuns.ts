/**
 * Lista local de senhas comuns (02-seguranca.md §6, linha "Lista local").
 *
 * É a REDE DE SEGURANÇA de quando o HIBP cai — o HIBP é fail-open de propósito
 * (B3), então sem esta lista uma queda da API abriria a porta para "123456".
 *
 * A régua pede **≥ 3.000**. Em vez de 3.000 linhas literais (que estourariam o
 * teto de 499 linhas por arquivo e seriam impossíveis de revisar), a lista é uma
 * BASE literal das famílias que realmente aparecem em vazamento brasileiro,
 * expandida pelas mutações que as pessoas fazem de verdade: ano no fim, `123` no
 * fim, primeira letra maiúscula, `@` no fim. `tests/unidade/senhas-comuns.test.ts`
 * trava o piso de 3.000 e a presença das campeãs.
 *
 * Módulo PURO: nenhum import, nenhum I/O. É importado pelo servidor e pela tela.
 */

/** Famílias literais. Tudo em minúsculas: a comparação normaliza a caixa. */
const BASE = [
  // numéricas e teclado
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345", "111111",
  "000000", "654321", "112233", "121212", "123123", "789456", "159753", "147258",
  "987654321", "1q2w3e4r", "1qaz2wsx", "qwerty", "qwertyui", "qwertyuiop",
  "asdfgh", "asdfghjkl", "zxcvbnm", "qazwsx", "poiuyt", "abcdef", "abcdefg",
  "abc123", "a1b2c3", "aaaaaa", "iloveyou", "letmein", "welcome", "monkey",
  "dragon", "master", "shadow", "sunshine", "princess", "football", "baseball",
  // português e Brasil
  "senha", "senha123", "minhasenha", "novasenha", "senhasegura", "mudar123",
  "brasil", "brasil123", "saopaulo", "riodejaneiro", "portoalegre", "curitiba",
  "gremio", "internacional", "flamengo", "corinthians", "palmeiras", "santos",
  "vasco", "botafogo", "fluminense", "cruzeiro", "atletico", "bahia", "sport",
  "amoteumor", "teamo", "amor", "amordaminhavida", "familia", "deusefiel",
  "deusnocomando", "jesus", "jesuscristo", "abencoado", "gratidao", "felicidade",
  "carnaval", "cerveja", "chimarrao", "churrasco", "feijoada", "cafezinho",
  "trabalho", "escritorio", "empresa", "vendas", "financeiro", "comercial",
  "administrador", "administrator", "usuario", "usuario123", "operador",
  "gerente", "vendedor", "atendente", "supervisor", "diretoria", "recepcao",
  "loja", "lojinha", "lojavirtual", "mercado", "boutique", "estoque", "caixa",
  "cliente", "clientes", "pedido", "pedidos", "entrega", "orcamento",
  // nomes muito comuns
  "maria", "joao", "jose", "ana", "paulo", "pedro", "lucas", "carlos", "bruno",
  "gabriel", "rafael", "juliana", "fernanda", "camila", "patricia", "amanda",
  "leticia", "beatriz", "larissa", "vitoria", "isabela", "mariana", "gustavo",
  "matheus", "felipe", "rodrigo", "eduardo", "marcelo", "roberto", "ricardo",
  "sandra", "silvia", "claudia", "adriana", "vanessa", "priscila", "tatiane",
  // animais e afetos
  "gatinho", "cachorro", "bolinha", "nina", "mel", "luna", "thor", "bidu",
  // genéricas de sistema
  "admin", "admin123", "root", "toor", "teste", "teste123", "testando",
  "password", "password1", "passw0rd", "p@ssw0rd", "changeme", "default",
  "temporaria", "provisoria", "primeiroacesso", "acesso", "entrar", "login",
  "sistema", "servidor", "banco", "backup", "suporte", "atendimento",
  "whatsapp", "instagram", "facebook", "internet", "computador", "celular",
  "notebook", "impressora", "wifi", "roteador", "conexao",
  // frases curtas que as pessoas acham fortes
  "euamominhamae", "ninguemadivinha", "essasenhaeboa", "senhadificil",
  "naovouesquecer", "melhorsenhadomundo", "sosemgraca", "queridodiario",
  "boradarcerto", "vamosquevamos", "focoeforca", "trabalhoduro",
] as const;

/** Sufixos que as pessoas realmente colam no fim de uma senha ruim. */
const SUFIXOS = ["", "1", "12", "123", "1234", "!", "@", "@123", "#", "00"];

/** Anos que aparecem em senha: nascimento, casamento, ano corrente. */
const ANOS = ["1990", "1995", "2000", "2010", "2020", "2024", "2025", "2026"];

function variantes(base: string): string[] {
  const capitalizada = base.charAt(0).toUpperCase() + base.slice(1);
  const formas = base === capitalizada ? [base] : [base, capitalizada];
  return formas.flatMap((forma) => [
    ...SUFIXOS.map((s) => `${forma}${s}`),
    ...ANOS.map((a) => `${forma}${a}`),
  ]);
}

/**
 * Variantes contextuais obrigatórias da régua: marca, rede e canal. São as
 * primeiras que qualquer pessoa da operação tentaria.
 */
export const CONTEXTO_DA_CASA = [
  "merlostore",
  "merlo",
  "merlochat",
  "centro",
  "cerroazul",
  "cerro",
  "whatsapp",
  "atendimento",
] as const;

/** Conjunto final, em minúsculas, sem acento. Montado uma vez por processo. */
export const SENHAS_COMUNS: ReadonlySet<string> = new Set(
  [...BASE, ...CONTEXTO_DA_CASA].flatMap(variantes).map((s) => s.toLowerCase()),
);

/** A senha vira minúscula e perde acento antes de bater na lista. */
export function ehSenhaComum(senha: string): boolean {
  const chave = senha
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return SENHAS_COMUNS.has(chave);
}
