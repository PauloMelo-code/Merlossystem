import { EstadoVazio } from "@/components/comum/estado-vazio";
import { Tempo } from "@/components/comum/tempo";

export type EventoNaTela = {
  tipo: string;
  meio: string | null;
  resultado: string;
  ip: string | null;
  quando: string;
};

/**
 * Últimos 20 eventos da PRÓPRIA conta (02-seguranca.md §11.1).
 *
 * É a trilha de acesso vista de dentro: entrada, saída, troca de senha, fator
 * cadastrado, recusa. A visão da rede inteira é `/auditoria/seguranca`, que
 * pede `seguranca:ler_eventos` e nasce no pacote M8.
 *
 * Componente de SERVIDOR: nada aqui reage a clique. O e-mail nunca aparece — na
 * trilha ele é HMAC, e esta tela não o consulta.
 */

/** Rótulo por tipo. Sem entrada, mostra o tipo cru em vez de inventar frase. */
const ROTULOS: Readonly<Record<string, string>> = {
  login_sucesso: "Entrou no sistema",
  login_falha: "Tentativa de entrada recusada",
  senha_aceita_aguardando_2fa: "Senha aceita, aguardando o segundo fator",
  logout: "Saiu do sistema",
  sessao_criada: "Sessão aberta",
  sessao_encerrada: "Sessão encerrada",
  conta_bloqueada: "Conta bloqueada por tentativas",
  conta_destravada: "Conta destravada",
  senha_trocada: "Senha alterada",
  reset_solicitado: "Link de recuperação pedido",
  reset_concluido: "Senha criada pelo link de recuperação",
  fator_adicionado: "Segundo fator cadastrado",
  fator_removido: "Segundo fator removido",
  passkey_adicionada: "Passkey cadastrada",
  passkey_removida: "Passkey removida",
  papel_alterado: "Papel alterado",
  admin_promovido: "Promovida a administradora",
  admin_rebaixado: "Deixou de ser administradora",
  posse_transferida: "Posse do sistema transferida",
  usuario_desativado: "Conta desativada",
  usuario_reativado: "Conta reativada",
  convite_usado: "Convite usado",
  dono_semeado: "Conta criada como dona do sistema",
  email_trocado: "E-mail alterado",
  recusa_403: "Acesso negado a uma ação",
  recuperacao_assistida: "Recuperação assistida pelo administrador",
};

const MEIOS: Readonly<Record<string, string>> = {
  senha: "com senha",
  "senha+totp": "com senha e código",
  passkey: "com passkey",
  convite: "por convite",
  reset: "por link de recuperação",
  admin: "pelo administrador",
  sistema: "pelo sistema",
};

export function EventosDaConta({ eventos }: { eventos: readonly EventoNaTela[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-titulo-secao font-medium">Atividade recente</h2>
        <p className="text-denso text-muted-foreground">
          Os últimos 20 acontecimentos da sua conta. Não reconhece algum? Troque a senha e
          avise o administrador.
        </p>
      </div>

      {eventos.length === 0 ? (
        <EstadoVazio
          titulo="Nada registrado ainda."
          descricao="A atividade aparece aqui a partir da sua próxima entrada."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {eventos.map((evento, indice) => (
            <li
              key={`${evento.tipo}-${evento.quando}-${String(indice)}`}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2"
            >
              <span className="text-corpo">
                {ROTULOS[evento.tipo] ?? evento.tipo}
                {evento.meio && MEIOS[evento.meio] ? ` ${MEIOS[evento.meio]}` : ""}
                {evento.resultado === "sucesso" ? "" : " · não concluído"}
              </span>
              <span className="text-legenda text-muted-foreground">
                <Tempo valor={evento.quando} />
                {evento.ip ? ` · ${evento.ip}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
