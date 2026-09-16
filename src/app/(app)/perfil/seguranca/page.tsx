import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { exigirSessao } from "@/lib/auth/guard";
import { estadoDosFatores, exigeDoisFatores } from "@/lib/auth/fatores";
import { listarSessoesDe } from "@/lib/auth/sessoes";
import { CabecalhoPagina } from "@/components/comum/cabecalho-pagina";
import { TrocarSenha } from "./_components/trocar-senha";
import { SubstituirFator } from "./_components/substituir-fator";
import { ListaPasskeys } from "./_components/lista-passkeys";
import { ListaSessoes } from "./_components/lista-sessoes";
import { EventosDaConta } from "./_components/eventos-da-conta";

export const metadata: Metadata = { title: "Segurança da conta" };

/** Últimos eventos da PRÓPRIA conta (02-seguranca.md §11.1). */
const EVENTOS_VISIVEIS = 20;

/**
 * `/perfil/seguranca` (02-seguranca.md §11.1, REQ-G1..G8; 04-ui.md §5.1).
 *
 * Alcançável de qualquer sessão — e também durante `precisa_trocar_senha`, com
 * escopo reduzido: é a única área que aquele gate libera, junto com `/sair`.
 *
 * A projeção de sessões NUNCA traz a coluna `token` (F6/G13) — quem monta a
 * lista é `listarSessoesDe`, que não a seleciona.
 *
 * O QUE ESTA TELA NÃO TEM, e não pode ter: desligar o segundo fator, remover o
 * último fator, gerar código de recuperação e ver a semente do TOTP (U13,
 * G4/G5).
 */
export default async function PaginaSeguranca() {
  const sessao = await exigirSessao({ trocaDeSenha: true });

  const [fatores, sessoes, eventos, senha] = await Promise.all([
    estadoDosFatores(sessao.usuarioId),
    listarSessoesDe(sessao.usuarioId, sessao.sessaoId),
    db.execute<{
      tipo: string;
      meio: string | null;
      resultado: string;
      ip: string | null;
      criado_em: Date;
    }>(sql`
      select tipo, meio, resultado, ip, criado_em from auth_eventos
      where usuario_id = ${sessao.usuarioId}::uuid
      order by criado_em desc
      limit ${EVENTOS_VISIVEIS}
    `),
    db.execute<{ criado_em: Date | null }>(sql`
      select max(criado_em) as criado_em from usuarios_senhas_historico
      where usuario_id = ${sessao.usuarioId}::uuid
    `),
  ]);

  const alteradaEm = senha.rows[0]?.criado_em ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-4 md:p-6">
      <CabecalhoPagina
        titulo="Segurança da conta"
        descricao="Senha, segundo fator, aparelhos cadastrados e sessões abertas."
      />

      <TrocarSenha
        alteradaEm={alteradaEm ? new Date(alteradaEm).toISOString() : null}
        precisaTrocar={sessao.precisaTrocarSenha}
      />

      <SubstituirFator totpAtivo={fatores.totpAtivo} temPasskey={fatores.passkeys.length > 0} />

      <ListaPasskeys
        passkeys={fatores.passkeys.map((chave) => ({
          ...chave,
          criadaEm: chave.criadaEm.toISOString(),
        }))}
        // Mesma regra de `removerPasskey`: dono e admin guardam ao menos uma (ADR 0029).
        podeRemover={
          fatores.total > 1 &&
          !(exigeDoisFatores(sessao.papel) && fatores.passkeys.length <= 1)
        }
      />

      <ListaSessoes
        sessoes={sessoes.map((aberta) => ({
          ...aberta,
          criadaEm: aberta.criadaEm.toISOString(),
          expiraEm: aberta.expiraEm.toISOString(),
        }))}
      />

      <EventosDaConta
        eventos={eventos.rows.map((evento) => ({
          tipo: evento.tipo,
          meio: evento.meio,
          resultado: evento.resultado,
          ip: evento.ip,
          quando: new Date(evento.criado_em).toISOString(),
        }))}
      />
    </div>
  );
}
