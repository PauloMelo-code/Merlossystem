"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Film, Music, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarExclusao } from "@/components/comum/confirmar-exclusao";
import { excluirMidia } from "@/lib/actions/midias";
import { rotuloDeTamanho } from "@/lib/armazenamento/limites";
import { rotaDaMidia, type MidiaDto } from "@/lib/midias/dto";
import { ROTULO_PASTA, ROTULO_TIPO } from "./rotulos";
import { Visualizador } from "./visualizador";

/**
 * Grade da galeria (04-ui.md §5.4). Excluir passa pelo bloqueio de 3 s
 * (§9.1, item 5) e é LÓGICO: mensagem que mostra a mídia continua mostrando.
 */

const ICONES = { video: Film, audio: Music, documento: FileText } as const;

function nomeDe(m: MidiaDto): string {
  return m.nomeOriginal ?? `${ROTULO_TIPO[m.tipoArquivo]} sem nome`;
}

export function GradeMidias({ midias, podeExcluir }: { midias: readonly MidiaDto[]; podeExcluir: boolean }) {
  const router = useRouter();
  const [aberta, setAberta] = useState<MidiaDto | null>(null);
  const [alvo, setAlvo] = useState<MidiaDto | null>(null);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  async function excluir(midia: MidiaDto) {
    setOcupado(true);
    setErro(undefined);
    const resultado = await excluirMidia({ id: midia.id, updated_at: midia.updatedAt, loja: midia.lojaId });
    setOcupado(false);
    if (!resultado.ok) {
      // Erro mantém o modal aberto (§9.1).
      setErro(resultado.mensagem);
      return;
    }
    setAlvo(null);
    toast.success("Mídia excluída.");
    router.refresh();
  }

  return (
    <>
      <ul aria-label="Mídias" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {midias.map((m) => {
          const Icone = m.tipoArquivo === "imagem" ? null : ICONES[m.tipoArquivo];
          return (
            <li key={m.id} className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
              <button
                type="button"
                onClick={() => setAberta(m)}
                aria-label={`Abrir ${nomeDe(m)}`}
                className="flex aspect-square items-center justify-center bg-muted"
              >
                {Icone ? (
                  <Icone aria-hidden="true" strokeWidth={2} className="size-8 text-muted-foreground" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- mídia privada não passa pelo otimizador (02-seguranca.md §15)
                  <img
                    src={rotaDaMidia(m.id, true)}
                    alt={nomeDe(m)}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
              </button>
              <div className="flex items-start justify-between gap-1 p-2">
                <div className="min-w-0">
                  <p className="truncate text-legenda font-medium" title={nomeDe(m)}>
                    {nomeDe(m)}
                  </p>
                  <p className="text-legenda text-texto-terciario">
                    {m.pasta ? `${ROTULO_PASTA[m.pasta]} · ` : ""}
                    {rotuloDeTamanho(m.tamanhoBytes)}
                  </p>
                </div>
                {podeExcluir ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${nomeDe(m)}`}
                    onClick={() => {
                      setErro(undefined);
                      setAlvo(m);
                    }}
                  >
                    <Trash2 aria-hidden="true" strokeWidth={2} />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Visualizador midia={aberta} aoFechar={() => setAberta(null)} />

      <ConfirmarExclusao
        aberto={alvo !== null}
        entidade={alvo ? `a mídia "${nomeDe(alvo)}"` : "a mídia"}
        descricao="Ela sai da galeria. Conversas que já mostram esta mídia continuam mostrando."
        carregando={ocupado}
        {...(erro === undefined ? {} : { erro })}
        onConfirmar={() => alvo && void excluir(alvo)}
        onCancelar={() => setAlvo(null)}
      />
    </>
  );
}
