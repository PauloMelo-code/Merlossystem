# Mapa do Projeto

> Gerado por `scripts/project-map.mjs`. Leia este resumo antes de explorar arquivos.

## Resumo

| Metrica | Total |
|---------|-------|
| Arquivos TS/TSX | 233 |
| Tabelas (Drizzle) | 48 |
| Server Actions (arquivos) | 3 |
| Rotas de API | 4 |
| Paginas | 7 |
| Componentes | 65 |

## Arvore (profundidade 3)

```
app/
  (app)/
    conversas/
    perfil/
    _acoes.ts
    error.tsx
    layout.tsx
    loading.tsx
    not-found.tsx
  (publico)/
    _components/
    entrar/
    esqueci-a-senha/
    primeiro-acesso/
    redefinir-senha/
    _acoes.ts
    layout.tsx
  api/
    auth/
    csp/
    pronto/
    saude/
  globals.css
  layout.tsx
components/
  comum/
    esqueletos/
    avatar-contato.tsx
    barra-ferramentas.tsx
    botao-enviar.tsx
    cabecalho-pagina.tsx
    campo.tsx
    chave-do-totp.tsx
    chip-filtro.tsx
    confirmar-exclusao.tsx
    copiar.tsx
    dinheiro.tsx
    estado-erro.tsx
    estado-vazio.tsx
    faixa-aviso.tsx
    icone-canal.tsx
    marca.tsx
    modal-confirmacao-block.tsx
    modal-reautenticacao.tsx
    paginacao-cursor.tsx
    resumo-de-erros.tsx
    selo-status.tsx
    tabela-dados.tsx
    tempo.tsx
  layout/
    busca-global.tsx
    cabecalho.tsx
    menu-usuario.tsx
    navegacao-lateral.tsx
    provedor-tema.tsx
    seletor-loja.tsx
    sino-alertas.tsx
    tab-bar.tsx
  ui/
    alert-dialog.tsx
    alert.tsx
    avatar.tsx
    badge.tsx
    breadcrumb.tsx
    button.tsx
    card.tsx
    chart.tsx
    checkbox.tsx
    collapsible.tsx
    command.tsx
    dialog.tsx
    dropdown-menu.tsx
    input-otp.tsx
    input.tsx
    label.tsx
    popover.tsx
    progress.tsx
    radio-group.tsx
    select.tsx
    separator.tsx
    sheet.tsx
    skeleton.tsx
    sonner.tsx
    switch.tsx
    table.tsx
    tabs.tsx
    textarea.tsx
    toggle-group.tsx
    toggle.tsx
    tooltip.tsx
lib/
  actions/
    _base.ts
    seguranca.ts
  auditoria/
    gravador.ts
  auth/
    permissoes/
    auth.ts
    bloqueio.ts
    caminhos.ts
    convites.ts
    emails.ts
    fatores.ts
    guard.ts
    kdf.ts
    loja.ts
    politica-senha.ts
    senha-gravada.ts
    senha-regras.ts
    senhas-comuns.ts
    sessoes.ts
    tokens.ts
    totp-replay.ts
    trilha.ts
  catalogo/
    disponibilidade.ts
  conversas/
    saida.ts
  db/
    migrations/
    schema/
    client.ts
    consultas.ts
    erros.ts
    listas-fechadas.ts
    migrate.ts
    mutacoes.ts
  fila/
    agendamentos.ts
    conexao.ts
    filas.ts
    idempotencia.ts
  midias/
    ingestao.ts
  rede/
    buscarExterno.ts
  seguranca/
    alertas.ts
    assinaturas.ts
    cofre.ts
    corpo.ts
    csp.ts
    ip.ts
    limite.ts
    maquina.ts
    origem.ts
    rotas-publicas.ts
  tempo-real/
    canal.ts
    publicar.ts
  ui/
    tons.ts
  validadores/
    comum.ts
  env.ts
  erros.ts
  formato.ts
  logger.ts
  marca.ts
  navegacao.ts
  qr.ts
server/
  processadores/
    agendamentos.ts
    campanhas.ts
    emails.ts
    integracoes.ts
    manutencao.ts
    mensagens-entrada.ts
    mensagens-saida.ts
    midia.ts
  sse.ts
  worker.ts
types/
  comum.ts
proxy.ts
```

## Tabelas (Drizzle)

### `alertas` — src/lib/db/schema/alertas.ts
`id`, `loja_id`, `tipo`, `severidade`, `mensagem`, `conversa_id`, `onDelete`, `onUpdate`, `contato_id`, `onDelete`, `onUpdate`, `pedido_id`, `onDelete`, `onUpdate`, `negocio_id`, `onDelete`, `onUpdate`, `chave_deduplicacao`, `reconhecido_por`, `onDelete`, `onUpdate`, `reconhecido_em`, `resolvido_em`

### `auditoria_eventos` — src/lib/db/schema/auditoria.ts
`id`, `criado_em`, `ator_tipo`, `ator_id`, `loja_id`, `acao`, `entidade`, `entidade_id`, `antes`, `depois`, `motivo`, `ip`, `agente`, `detalhes`

### `usuarios_contas` — src/lib/db/schema/auth/contas.ts
`id`, `usuario_id`, `conta_id`, `provedor_id`, `senha_hash`, `access_token`, `refresh_token`, `id_token`, `access_token_expira_em`, `refresh_token_expira_em`, `escopo`

### `usuarios_convites` — src/lib/db/schema/auth/convites.ts
`id`, `email`, `papel`, `loja_id`, `onDelete`, `onUpdate`, `token_hash`, `expira_em`, `usado_em`, `usado_por_usuario_id`, `onDelete`, `onUpdate`, `criado_por`, `onDelete`, `onUpdate`, `ciencia_versao`, `bootstrap`, `motivo`

### `usuarios_passkeys` — src/lib/db/schema/auth/passkeys.ts
`id`, `usuario_id`, `nome`, `chave_publica`, `credential_id`, `contador`, `tipo_dispositivo`, `backed_up`, `transportes`, `aaguid`, `created_at`

### `usuarios_senhas_historico` — src/lib/db/schema/auth/senhas-historico.ts
`id`, `usuario_id`, `senha_hash`, `criado_em`

### `usuarios_sessoes` — src/lib/db/schema/auth/sessoes.ts
`id`, `token`, `usuario_id`, `expira_em`, `ip`, `agente`, `ultimo_uso_em`, `reautenticada_em`, `created_at`, `updated_at`

### `usuarios_totp` — src/lib/db/schema/auth/totp.ts
`id`, `usuario_id`, `secret`, `backup_codes`, `ultimo_passo_totp`, `verificado`, `falhas_verificacao`, `bloqueado_ate`, `created_at`

### `usuarios_trocas_email` — src/lib/db/schema/auth/trocas-email.ts
`id`, `usuario_id`, `email_novo`, `codigo_hash`, `expira_em`, `tentativas`, `confirmado_em`, `cancelado_em`, `cancelado_motivo`, `solicitado_por`, `motivo`

### `usuarios` — src/lib/db/schema/auth/usuarios.ts
`id`, `nome`, `email`, `email_verificado`, `avatar_url`, `papel`, `loja_id`, `onDelete`, `onUpdate`, `ativo`, `precisa_trocar_senha`, `precisa_configurar_fator`, `two_factor_enabled`, `falhas_login`, `ultima_falha_em`, `bloqueado_ate`, `ultimo_login_em`, `anonimizado_em`

### `usuarios_verificacoes` — src/lib/db/schema/auth/verificacoes.ts
`id`, `identificador`, `valor`, `expira_em`, `created_at`, `updated_at`

### `auth_eventos` — src/lib/db/schema/auth-eventos.ts
`id`, `criado_em`, `tipo`, `ator_tipo`, `usuario_id`, `email_hash`, `sessao_id`, `meio`, `resultado`, `ip`, `agente`, `ator_id`, `alvo_id`, `motivo`, `detalhes`

### `campanhas` — src/lib/db/schema/campanhas.ts
`id`, `loja_id`, `nome`, `integracao_id`, `template_id`, `onDelete`, `onUpdate`, `conteudo_texto`, `variaveis`, `segmento`, `status`, `agendada_para`, `iniciada_em`, `concluida_em`, `total_destinatarios`, `criada_por`

### `campanhas_destinatarios` — src/lib/db/schema/campanhas.ts
`id`, `loja_id`, `campanha_id`, `contato_id`, `status`, `mensagem_id`, `onDelete`, `onUpdate`, `externo_id`, `erro`, `reservado_em`, `enviado_em`, `entregue_em`, `lido_em`, `respondido_em`, `tentativas`

### `produtos_categorias` — src/lib/db/schema/catalogo/categorias.ts
`id`, `loja_id`, `nome`, `slug`

### `produtos_midias` — src/lib/db/schema/catalogo/produtos-midias.ts
`id`, `loja_id`, `produto_id`, `midia_id`, `ordem`

### `produtos` — src/lib/db/schema/catalogo/produtos.ts
`id`, `loja_id`, `categoria_id`, `onDelete`, `onUpdate`, `nome`, `sku`, `descricao`, `tipo_grade`, `preco`, `preco_comparacao`, `preco_custo`, `peso_gramas`, `destacado`, `bling_produto_id`, `sincronizado_em`

### `produtos_variacoes` — src/lib/db/schema/catalogo/variacoes.ts
`id`, `loja_id`, `produto_id`, `tamanho`, `sku`, `bling_produto_id`

### `contatos` — src/lib/db/schema/contatos.ts
`id`, `loja_id`, `nome`, `telefone`, `email`, `whatsapp_id`, `instagram_id`, `facebook_id`, `tiktok_id`, `avatar_url`, `tamanho_preferido`, `observacoes`, `aniversario`, `endereco`, `ultimo_contato_em`, `ultima_compra_em`, `opt_out`, `opt_out_em`, `pedidos_contagem`, `pedidos_valor_total`, `anonimizado_em`

### `contatos_etiquetas` — src/lib/db/schema/contatos.ts
`id`, `loja_id`, `contato_id`, `etiqueta_id`, `origem`

### `base_conhecimento_artigos` — src/lib/db/schema/conteudo/base-conhecimento.ts
`id`, `loja_id`, `titulo`, `conteudo`, `categoria`, `criado_por`, `onDelete`, `onUpdate`

### `base_conhecimento_artigos_etiquetas` — src/lib/db/schema/conteudo/base-conhecimento.ts
`id`, `loja_id`, `artigo_id`, `onDelete`, `onUpdate`, `etiqueta_id`

### `lookbooks` — src/lib/db/schema/conteudo/lookbooks.ts
`id`, `loja_id`, `nome`, `descricao`, `capa_midia_id`, `onDelete`, `onUpdate`

### `lookbooks_midias` — src/lib/db/schema/conteudo/lookbooks.ts
`id`, `loja_id`, `lookbook_id`, `midia_id`, `ordem`

### `lookbooks_produtos` — src/lib/db/schema/conteudo/lookbooks.ts
`id`, `loja_id`, `lookbook_id`, `produto_id`, `ordem`

### `respostas_rapidas` — src/lib/db/schema/conteudo/respostas-rapidas.ts
`id`, `loja_id`, `titulo`, `conteudo`, `categoria`, `atalho`, `ativa`

### `conversas_agendamentos` — src/lib/db/schema/conversas/agendamentos.ts
`id`, `loja_id`, `contato_id`, `conversa_id`, `onDelete`, `onUpdate`, `integracao_id`, `conteudo`, `tipo_conteudo`, `template_id`, `onDelete`, `onUpdate`, `variaveis`, `midia_id`, `onDelete`, `onUpdate`, `agendada_para`, `gatilho`, `status`, `enviada_em`, `mensagem_id`, `onDelete`, `onUpdate`, `erro`, `cancelada_por`, `onDelete`, `onUpdate`

### `conversas` — src/lib/db/schema/conversas/conversas.ts
`id`, `loja_id`, `contato_id`, `integracao_id`, `status`, `prioridade`, `responsavel_id`, `onDelete`, `onUpdate`, `ultima_mensagem_em`, `ultima_mensagem_previa`, `ultima_entrada_em`, `nao_lidas`, `primeira_resposta_em`, `sla_estourado_em`, `resolvida_em`, `resolvida_por`, `onDelete`, `onUpdate`

### `conversas_mensagens_midias` — src/lib/db/schema/conversas/mensagens-midias.ts
`id`, `loja_id`, `mensagem_id`, `midia_id`, `onDelete`, `onUpdate`, `url_externa`, `externo_id`, `tipo_arquivo`, `mime_type`, `tamanho_bytes`, `legenda`, `baixada`, `transcricao`, `transcricao_status`

### `conversas_mensagens` — src/lib/db/schema/conversas/mensagens.ts
`id`, `loja_id`, `conversa_id`, `direcao`, `autor_tipo`, `autor_usuario_id`, `onDelete`, `onUpdate`, `conteudo`, `tipo_conteudo`, `externo_id`, `status_entrega`, `status_atualizado_em`, `falha_motivo`, `nota_interna`, `responde_a_id`, `chave_idempotencia`, `ocorrida_em`, `metadados`

### `pedidos_devolucoes` — src/lib/db/schema/devolucoes.ts
`id`, `loja_id`, `pedido_id`, `contato_id`, `conversa_id`, `onDelete`, `onUpdate`, `tipo`, `motivo`, `motivo_detalhe`, `status`, `rastreio_codigo`, `valor_estorno`, `metodo_estorno`, `pagamento_id`, `onDelete`, `onUpdate`, `resolvido_por`, `onDelete`, `onUpdate`, `resolvido_em`

### `pedidos_devolucoes_itens` — src/lib/db/schema/devolucoes.ts
`id`, `loja_id`, `devolucao_id`, `pedido_item_id`, `quantidade`

### `pedidos_devolucoes_midias` — src/lib/db/schema/devolucoes.ts
`id`, `loja_id`, `devolucao_id`, `midia_id`

### `lojas_integracoes` — src/lib/db/schema/integracoes.ts
`id`, `loja_id`, `onDelete`, `onUpdate`, `provedor`, `rotulo`, `status`, `credenciais_cifradas`, `credenciais_aad`, `referencia_externa`, `segredo_webhook_hash`, `expira_em`, `ultimo_erro`, `ultima_sincronizacao`, `revogada_em`

### `lojas_integracoes_eventos` — src/lib/db/schema/integracoes.ts
`id`, `provedor`, `integracao_id`, `loja_id`, `tipo`, `evento_externo_id`, `assinatura_ok`, `ip`, `corpo`, `cabecalhos`, `erro`, `processado_em`

### `lojas_integracoes_templates` — src/lib/db/schema/integracoes.ts
`id`, `loja_id`, `integracao_id`, `nome`, `categoria`, `idioma`, `cabecalho_tipo`, `cabecalho_conteudo`, `corpo`, `rodape`, `botoes`, `variaveis_contagem`, `meta_template_id`, `status`, `motivo_rejeicao`, `enviado_em`, `aprovado_em`

### `consentimentos` — src/lib/db/schema/lgpd.ts
`id`, `criado_em`, `loja_id`, `contato_id`, `tipo`, `concedido`, `origem`, `canal`, `mensagem_id`, `termo_versao`, `ip`, `registrado_por`

### `lgpd_solicitacoes` — src/lib/db/schema/lgpd.ts
`id`, `loja_id`, `contato_id`, `tipo`, `protocolo`, `motivo`, `solicitado_em`, `executado_por`, `onDelete`, `onUpdate`, `executado_em`, `resultado`

### `pesquisas_satisfacao` — src/lib/db/schema/lgpd.ts
`id`, `loja_id`, `contato_id`, `conversa_id`, `onDelete`, `onUpdate`, `pedido_id`, `onDelete`, `onUpdate`, `nota`, `comentario`, `gatilho`, `mensagem_id`, `onDelete`, `onUpdate`, `enviada_em`, `respondida_em`

### `lojas` — src/lib/db/schema/lojas.ts
`id`, `nome`, `slug`, `sigla`, `bling_deposito_id`

### `lojas_etiquetas` — src/lib/db/schema/lojas.ts
`id`, `loja_id`, `nome`, `slug`, `cor`

### `lojas_midias` — src/lib/db/schema/midias.ts
`id`, `loja_id`, `nome_original`, `chave_objeto`, `chave_miniatura`, `tipo_arquivo`, `mime_type`, `tamanho_bytes`, `largura`, `altura`, `duracao_ms`, `hash_sha256`, `origem`, `pasta`, `enviada_por`, `onDelete`, `onUpdate`

### `lojas_midias_etiquetas` — src/lib/db/schema/midias.ts
`id`, `loja_id`, `midia_id`, `etiqueta_id`

### `negocios` — src/lib/db/schema/negocios.ts
`id`, `loja_id`, `contato_id`, `conversa_id`, `onDelete`, `onUpdate`, `responsavel_id`, `onDelete`, `onUpdate`, `estagio`, `valor`, `motivo_perda`, `observacao_perda`, `previsao_fechamento`, `ultima_atividade_em`

### `pedidos_itens` — src/lib/db/schema/pedidos/itens.ts
`id`, `loja_id`, `pedido_id`, `produto_id`, `variacao_id`, `onDelete`, `onUpdate`, `sku`, `nome`, `tamanho`, `quantidade`, `preco_unitario`, `total_item`

### `pedidos_numeracao` — src/lib/db/schema/pedidos/numeracao.ts
`loja_id`, `ano_mes`, `ultimo_numero`

### `pagamentos` — src/lib/db/schema/pedidos/pagamentos.ts
`id`, `loja_id`, `pedido_id`, `provedor`, `metodo`, `status`, `valor`, `externo_id`, `pix_copia_cola`, `qrcode_midia_id`, `onDelete`, `onUpdate`, `link_pagamento`, `expira_em`, `pago_em`, `estornado_em`, `criado_por`, `onDelete`, `onUpdate`

### `pedidos` — src/lib/db/schema/pedidos/pedidos.ts
`id`, `loja_id`, `contato_id`, `negocio_id`, `onDelete`, `onUpdate`, `conversa_id`, `onDelete`, `onUpdate`, `numero`, `status`, `pagamento_status`, `subtotal`, `frete`, `desconto`, `total`, `forma_pagamento`, `entrega_metodo`, `rastreio_codigo`, `rastreio_url`, `endereco_entrega`, `observacoes`, `masc_status`, `masc_venda_id`, `masc_lancado_em`, `masc_lancado_por`, `onDelete`, `onUpdate`, `masc_observacao`, `cancelado_em`, `cancelado_motivo`, `criado_por`

## Rotas de API

| Rota | Metodos |
|------|---------|
| `/api/auth/[...all]` | GET, POST |
| `/api/csp` | POST |
| `/api/pronto` | GET |
| `/api/saude` | GET |

## Server Actions

- `src/app/(app)/_acoes.ts`: `trocarLojaAtiva()`, `sair()`
- `src/app/(publico)/_acoes.ts`: `definirSenhaDoConvite()`, `redefinirSenha()`, `prepararTotpDoPrimeiroAcesso()`, `confirmarTotpDoPrimeiroAcesso()`, `prepararPasskeyDoPrimeiroAcesso()`, `confirmarPasskeyDoPrimeiroAcesso()`
- `src/lib/actions/seguranca.ts`: `salvarPerfil()`, `reautenticar()`, `trocarSenha()`, `iniciarCadastroDeTotp()`, `confirmarCadastroDeTotp()`, `iniciarCadastroDePasskey()`, `confirmarCadastroDePasskey()`, `renomearChave()`, `removerChave()`, `encerrarSessao()`, `encerrarTodasAsSessoes()`

## Paginas

- `src/app/(app)/perfil/page.tsx`
- `src/app/(app)/perfil/seguranca/page.tsx`
- `src/app/(publico)/entrar/page.tsx`
- `src/app/(publico)/entrar/verificar/page.tsx`
- `src/app/(publico)/esqueci-a-senha/page.tsx`
- `src/app/(publico)/primeiro-acesso/page.tsx`
- `src/app/(publico)/redefinir-senha/page.tsx`
