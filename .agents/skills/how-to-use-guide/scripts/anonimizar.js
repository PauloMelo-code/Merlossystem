(() => {
  /* .claude/skills/how-to-use-guide/scripts/anonimizar.js
   *
   * Anonimização dos prints que SAEM da empresa. Rodado via CDP
   * (`Runtime.evaluate`) por `capturar-prints.mjs`, sempre em ARQUIVO PRÓPRIO:
   * dentro de um template literal o JS engoliria `\s` e `\/` e a função
   * quebraria em silêncio, produzindo prints sem anonimização nenhuma.
   *
   * CINCO CAMADAS, de cirúrgica para genérica — a ordem importa:
   *   1. CAMPO DE FORMULÁRIO por `id`/`name` (modal do ERP: `#name`,
   *      `#document`, `#email`, `#phone`, `#address.street`…). É o mais preciso:
   *      o campo declara o que é.
   *   2. CÉLULA DE TABELA pela coluna, achada pelo TEXTO DO <th> — não por
   *      posição. É o que faz o mesmo script servir em /clientes/cadastro,
   *      /financeiro/receber e /cobrancas/assinaturas ("Nome", "Documento",
   *      "Email", "Telefone", "Cliente").
   *   3. PADRÃO EVIDENTE em qualquer lugar (e-mail, CPF, CNPJ, linha digitável,
   *      copia-e-cola do PIX, URL de cliente).
   *   4. RAZÃO SOCIAL solta em painel/modal, por heurística conservadora.
   *   5. USUÁRIO LOGADO no rodapé da sidebar (iniciais, nome e cargo de quem
   *      tirou o print) — alvo ESTRUTURAL; ver o comentário da seção 5.
   *
   * ⚠️ A camada 4 é DELIBERADAMENTE tímida: já quebrou uma vez ao trocar o
   * título "Editar cliente" e um código truncado por nomes fictícios. Rótulo de
   * interface JAMAIS pode ser reescrito — o leitor perde a referência da tela.
   * Nome de PESSOA solto em texto não é pego por ela; é isso que o relatório
   * `conferirManualmente` avisa. Confie no olho, não só no script.
   *
   * Valor em dinheiro NÃO é tratado aqui: use a máscara nativa do ERP
   * (`document.documentElement.dataset.valuePrivacy = 'masked'`).
   *
   * Idempotente: cada elemento tratado recebe `data-anon`, então rodar duas
   * vezes não re-processa nem infla o relatório.
   */

  /* ---------------------------------------------------------------- padrões */
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  const RE_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
  // CNPJ ALFANUMÉRICO (IN RFB 2.229/2024): as 12 primeiras posições podem ter
  // letras; só os 2 dígitos verificadores continuam numéricos. Padrão
  // apenas-numérico deixaria CNPJ novo passar em claro no print.
  const RE_CNPJ = /^[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}$/i;
  const RE_TELEFONE = /^(\+?\d{1,3}\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}$/;
  // Linha digitável de boleto / copia-e-cola do PIX: nunca sai inteiro.
  const RE_CODIGO_LONGO = /^(\d[\d\s.]{29,}|000201[\s\S]{20,})$/;
  const RE_CEP = /^\d{5}-?\d{3}$/;

  const FICT = {
    empresas: ['ÓTICAS EXEMPLO LTDA', 'SUA EMPRESA LTDA', 'COMÉRCIO EXEMPLO ME', 'CLÍNICA EXEMPLO S.A.'],
    pessoas: ['Maria Exemplo', 'João da Silva', 'Ana Souza', 'Carlos Pereira'],
    email: 'financeiro@suaempresa.com.br',
    telefone: '(51) 9****-****',
    cep: '90000-000',
    rua: 'Rua Exemplo',
    numero: '100',
    complemento: 'Sala 1',
    bairro: 'Centro',
    url: 'https://sistema.suaempresa.com.br/…',
    operador: { nome: 'Operador BahTech', email: 'operador@bahtech.com.br' },
  };

  /** Rótulos de interface: nunca reescrever (o leitor se perde na tela). */
  const RE_ROTULO_UI = /^(id|cpf|cnpj|cep|pix|boleto|cart[ãa]o|status|a[çc][õo]es|editar|excluir|salvar|cancelar|fechar|novo|nova|adicionar|filtros?|buscar|limpar|total|valor|bruto|l[íi]quido|vencimento|pago|pendente|atrasado|vencido|estornado|cancelado|recebido|assinatura|plano|cliente|cobran[çc]a|nota|competência|descri[çc][ãa]o|per[íi]odo|dados|endere[çc]o|contato|observa[çc][õo]es)\b/i;

  const relatorio = {
    campos: [], colunas: [], celulas: 0, emails: 0, documentos: 0, telefones: 0,
    enderecos: 0, codigos: 0, urls: 0, painel: 0, usuarioLogado: 0, conferirManualmente: [],
  };

  /* CSS de apoio: aplique `.anon-blur` à mão quando o conteúdo da coluna não
   * importa para o passo (tabela longa) e substituir seria trabalho perdido. */
  if (!document.getElementById('anon-estilo')) {
    const st = document.createElement('style');
    st.id = 'anon-estilo';
    st.textContent = '.anon-blur{filter:blur(5px) !important}';
    document.head.appendChild(st);
  }

  const tratado = (el) => el.hasAttribute('data-anon');
  const marcar = (el) => el.setAttribute('data-anon', '1');

  const memoria = new Map();
  let iEmpresa = 0;
  let iPessoa = 0;

  /** Mesmo original → mesmo fictício (a tabela e o modal contam a mesma história). */
  const nomeFicticio = (original) => {
    if (memoria.has(original)) return memoria.get(original);
    const letras = original.replace(/[^A-Za-zÀ-ú]/g, '');
    const maiusculas = original.replace(/[^A-ZÀ-Ú]/g, '');
    const societario = /\b(LTDA|EIRELI|MEI|S\.?A\.?|ME)\b/i.test(original);
    // 0,6 (e não 0,7) porque razão social costuma trazer um trecho em caixa
    // mista — "(Matriz/Venâncio Aires)" — que derruba a proporção.
    const empresa = societario || (letras.length > 8 && maiusculas.length / letras.length > 0.6);
    const valor = empresa
      ? FICT.empresas[iEmpresa++ % FICT.empresas.length]
      : FICT.pessoas[iPessoa++ % FICT.pessoas.length];
    memoria.set(original, valor);
    return valor;
  };

  const mascararDocumento = (t) => (RE_CPF.test(t) ? '***.***.***-**' : '**.***.***/****-**');

  /* ------------------------------------- 1. campos de formulário (o preciso) */
  // O valor é escrito DIRETO no DOM, sem disparar `input`: não queremos sujar o
  // estado do React nem marcar o formulário como alterado. O print é tirado em
  // seguida; um re-render restauraria o valor real (tire o print logo depois).
  const CAMPOS = [
    { re: /(^|\.)name$|^nome$|razao|fantasia/i, valor: (el) => nomeFicticio(el.value || 'CLIENTE EXEMPLO LTDA') },
    { re: /(^|\.)document$|^cpf$|^cnpj$/i, valor: (el) => mascararDocumento(el.value || '00.000.000/0000-00') },
    { re: /(^|\.)email$/i, valor: () => FICT.email },
    { re: /(^|\.)phone$|telefone|celular|whats/i, valor: () => FICT.telefone },
    { re: /\.zip$|^cep$/i, valor: () => FICT.cep },
    { re: /\.street$|logradouro|^rua$/i, valor: () => FICT.rua },
    { re: /\.number$/i, valor: () => FICT.numero },
    { re: /\.complement$/i, valor: () => FICT.complemento },
    { re: /\.district$|bairro/i, valor: () => FICT.bairro },
    { re: /\.latitude$|\.longitude$/i, valor: () => '' },
  ];

  for (const el of document.querySelectorAll('input, textarea')) {
    if (tratado(el)) continue;
    const chave = el.id || el.getAttribute('name') || '';
    if (!chave) continue;
    const regra = CAMPOS.find((c) => c.re.test(chave));
    if (!regra) continue;
    const antes = el.value;
    el.value = regra.valor(el);
    marcar(el);
    if (antes !== el.value) { relatorio.campos.push(chave); relatorio.enderecos += /zip|street|number|complement|district/i.test(chave) ? 1 : 0; }
  }

  /* ----------------------------- 2. células de tabela pelo texto do cabeçalho */
  const COLUNAS = [
    { re: /^(nome|cliente|raz[ãa]o|fornecedor|benefici|tomador)/i, modo: 'nome' },
    { re: /^(documento|cpf|cnpj)/i, modo: 'documento' },
    { re: /^(e-?mail)/i, modo: 'email' },
    { re: /^(telefone|celular|whats)/i, modo: 'telefone' },
  ];

  const tratarCelula = (celula, modo) => {
    let n = 0;
    const folhas = celula.children.length ? [...celula.querySelectorAll('*')].filter((e) => !e.children.length) : [celula];
    for (const el of folhas) {
      if (tratado(el)) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      if (modo === 'documento' && (RE_CPF.test(t) || RE_CNPJ.test(t))) { el.textContent = mascararDocumento(t); relatorio.documentos++; }
      else if (modo === 'email' && RE_EMAIL.test(t)) { el.textContent = FICT.email; relatorio.emails++; }
      else if (modo === 'telefone' && RE_TELEFONE.test(t)) { el.textContent = FICT.telefone; relatorio.telefones++; }
      else if (modo === 'nome' && t.replace(/[^A-Za-zÀ-ú]/g, '').length > 4 && !RE_ROTULO_UI.test(t)) { el.textContent = nomeFicticio(t); }
      else continue;
      marcar(el);
      n++;
    }
    return n;
  };

  for (const tabela of document.querySelectorAll('table')) {
    const cabecalhos = [...tabela.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
    const mapa = new Map();
    cabecalhos.forEach((titulo, i) => {
      const regra = COLUNAS.find((c) => c.re.test(titulo));
      if (regra) { mapa.set(i, regra.modo); relatorio.colunas.push(`${titulo} → ${regra.modo}`); }
      if (/^descri/i.test(titulo)) relatorio.conferirManualmente.push('coluna "Descrição" pode citar nome de cliente — leia o print');
    });
    if (!mapa.size) continue;
    for (const linha of tabela.querySelectorAll('tbody tr')) {
      for (const [i, modo] of mapa) {
        if (linha.children[i]) relatorio.celulas += tratarCelula(linha.children[i], modo);
      }
    }
  }

  /* ----------------------------------- 3. padrão evidente em qualquer lugar */
  for (const el of document.querySelectorAll('td, span, p, div, dd, li, a, strong, small')) {
    if (el.children.length || tratado(el)) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    if (RE_CPF.test(t) || RE_CNPJ.test(t)) { el.textContent = mascararDocumento(t); relatorio.documentos++; }
    else if (RE_EMAIL.test(t)) { el.textContent = FICT.email; relatorio.emails++; }
    else if (RE_CODIGO_LONGO.test(t)) { el.textContent = `${t.slice(0, 12)}…  (código encurtado neste guia)`; relatorio.codigos++; }
    else if (/^https?:\/\//i.test(t) && !/localhost/.test(t)) { el.textContent = FICT.url; relatorio.urls++; }
    else if (RE_CEP.test(t)) { el.textContent = FICT.cep; relatorio.enderecos++; }
    else continue;
    // `title`/`aria-label` guardam o dado ORIGINAL: o rodapé do ERP tem
    // `<li title={user.email}>`, então trocar só o texto visível deixava o
    // e-mail real dentro do atributo — invisível no PNG, presente no HTML.
    for (const attr of ['title', 'aria-label']) {
      if (el.getAttribute(attr)) el.setAttribute(attr, el.textContent || '');
    }
    marcar(el);
  }

  /* --------------------- 4. razão social solta em painel/modal (conservador) */
  for (const painel of document.querySelectorAll('[role="dialog"], aside')) {
    for (const el of painel.querySelectorAll('*')) {
      if (el.children.length || tratado(el)) continue;
      const t = (el.textContent || '').trim();
      if (!t || RE_ROTULO_UI.test(t)) continue;
      const letras = t.replace(/[^A-Za-zÀ-ú]/g, '');
      const maiusculas = t.replace(/[^A-ZÀ-Ú]/g, '');
      const societario = /\b(LTDA|EIRELI|MEI|S\.?A\.?|ME)\b/i.test(t);
      const parecemRazaoSocial = letras.length > 8 && t.split(/\s+/).length >= 2 && (societario || maiusculas.length / letras.length > 0.6);
      if (!parecemRazaoSocial) continue;
      el.textContent = nomeFicticio(t);
      marcar(el);
      relatorio.painel++;
    }
  }

  /* -------------------------------------- 5. usuário logado (rodapé sidebar) */
  // ⚠️ ALVO ESTRUTURAL, e não por padrão de e-mail. Verificado em
  // src/components/Sidebar.tsx: o rodapé (`<footer>`) mostra INICIAIS + NOME +
  // badge de cargo dentro do botão `aria-label="Abrir menu do usuário"`; o
  // E-MAIL e a lista de cargos vivem SÓ no dropdown, que nasce fechado
  // (`isUserMenuOpen = false`) e portanto não está no DOM do print. Procurar
  // e-mail aqui NUNCA casava — e o nome real do operador saía em todo print.
  // O seletor EXIGE evidência estrutural de que é o gatilho do usuário. Um
  // fallback largo (`footer button`) reescrevia o primeiro botão de QUALQUER
  // rodapé — destruindo texto de interface — e, pior, incrementava o contador,
  // suprimindo o aviso de "não encontrado". Não achar é melhor que estragar.
  const botaoUsuario =
    document.querySelector('footer button[aria-label*="menu do usu"]')
    || document.querySelector('aside footer button[aria-label], nav footer button[aria-label]');

  if (botaoUsuario) {
    const iniciais = [...botaoUsuario.querySelectorAll('span')].find(
      (el) => !el.children.length && (el.textContent || '').trim().length <= 3,
    );
    if (iniciais) { iniciais.textContent = 'OB'; marcar(iniciais); relatorio.usuarioLogado++; }

    const paragrafos = [...botaoUsuario.querySelectorAll('p')].filter((el) => !el.children.length);
    if (paragrafos[0]) { paragrafos[0].textContent = FICT.operador.nome; marcar(paragrafos[0]); relatorio.usuarioLogado++; }
    // Cargo/permissão também identifica a pessoa numa equipe pequena.
    for (const el of paragrafos.slice(1)) { el.textContent = 'Operação'; marcar(el); relatorio.usuarioLogado++; }
    // O `title` do botão carrega o nome quando a sidebar está recolhida.
    if (botaoUsuario.getAttribute('title')) botaoUsuario.setAttribute('title', FICT.operador.nome);
  } else {
    relatorio.conferirManualmente.push('rodapé do usuário não encontrado — se o print inclui a sidebar, confira o nome do operador à mão');
  }

  // O dropdown do usuário (quando ABERTO) traz e-mail e a lista de cargos — mas
  // NÃO há laço para isso aqui de propósito: a camada 3 já casa qualquer e-mail
  // da página, marca `data-anon` e desde a correção de auditoria limpa também
  // `title`/`aria-label` (o rodapé real tem `<li title={user.email}>`). Um
  // segundo laço aqui seria código morto — todo elemento chegaria já `tratado`.

  if (!relatorio.colunas.length && !relatorio.campos.length) {
    relatorio.conferirManualmente.push('nada casou por coluna/campo — a tela pode ser dashboard ou gráfico: confira à mão');
  }
  relatorio.conferirManualmente.push('nome de PESSOA solto em texto corrido não é detectado — leia cada PNG antes de embutir');
  return relatorio;
})()
