"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

/**
 * Navegacao de pagina para listas longas.
 *
 * As rotas SEMPRE pagina(va)m — `limiteDaPagina` grampeia em 100 por pagina —
 * mas as telas nunca mandavam `page`. O efeito era uma lista que parecia
 * completa e nao era: 569 produtos viravam os 20 primeiros, e o resto do
 * catalogo simplesmente nao tinha como ser alcancado.
 */
export function Paginacao({
  pagina,
  limite,
  total,
  onMudar,
  carregando,
}: {
  pagina: number
  limite: number
  total: number
  onMudar: (pagina: number) => void
  carregando?: boolean
}) {
  const ultima = Math.max(1, Math.ceil(total / limite))
  // Uma pagina so nao precisa de controle nenhum ocupando a tela.
  if (total === 0 || ultima === 1) return null

  const primeiro = (pagina - 1) * limite + 1
  const ultimo = Math.min(pagina * limite, total)

  return (
    <div className="flex items-center justify-between gap-4 px-2 py-3 text-sm">
      <span className="text-muted-foreground">
        {primeiro}–{ultimo} de {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Página anterior"
          disabled={pagina <= 1 || carregando}
          onClick={() => onMudar(pagina - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>
        <span className="text-muted-foreground">
          {pagina} de {ultima}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Próxima página"
          disabled={pagina >= ultima || carregando}
          onClick={() => onMudar(pagina + 1)}
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
