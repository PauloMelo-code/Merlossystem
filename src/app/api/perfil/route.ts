import { NextResponse } from "next/server"
import { z } from "zod"
import { compare, hash } from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { registrar } from "@/lib/auditoria"
import { usuarioDaSessao, semSessao } from "@/lib/sessao"
import { escopoDaLoja } from "@/lib/loja"

/**
 * A PRÓPRIA conta: nome, foto e senha.
 *
 * Existe separada de `/api/usuarios/[id]` porque aquela é de administração
 * (criar pessoa, trocar papel, desativar) e fica fechada em admin. Trocar a
 * própria senha não é administração: é a pessoa cuidando do acesso dela, e
 * sem isto a vendedora dependia do administrador para toda troca — o que na
 * prática vira senha compartilhada no grupo do WhatsApp.
 *
 * O que esta rota NUNCA faz: mudar papel, loja ou o estado ativo. Esses
 * continuam só na administração; senão qualquer pessoa se promoveria.
 */

const atualizacao = z
  .object({
    name: z.string().trim().min(2, "Nome muito curto").max(80).optional(),
    /** Id de `media_files` (o upload já aconteceu em /api/media/upload). */
    avatarMediaId: z.string().uuid().nullable().optional(),
    senhaAtual: z.string().min(1).optional(),
    novaSenha: z.string().min(8, "A senha precisa de ao menos 8 caracteres").max(200).optional(),
  })
  .refine((d) => !d.novaSenha || d.senhaAtual, {
    message: "Informe a senha atual para trocar a senha.",
    path: ["senhaAtual"],
  })

export async function GET() {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const pessoa = await prisma.user.findUnique({
    where: { id: usuario.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      store: { select: { id: true, nome: true } },
    },
  })
  if (!pessoa) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  return NextResponse.json(pessoa)
}

export async function PUT(req: Request) {
  const usuario = await usuarioDaSessao()
  if (!usuario) return semSessao()

  const parse = atualizacao.safeParse(await req.json().catch(() => null))
  if (!parse.success) {
    return NextResponse.json(
      { error: parse.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    )
  }
  const dados = parse.data

  const atual = await prisma.user.findUnique({
    where: { id: usuario.id },
    select: { id: true, passwordHash: true, storeId: true },
  })
  if (!atual) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })

  const mudanca: Record<string, unknown> = {}
  if (dados.name !== undefined) mudanca.name = dados.name

  // Foto: o arquivo já subiu pela rota de mídia; aqui só se guarda o endereço,
  // e a mídia precisa ser da MESMA loja de quem está trocando.
  if (dados.avatarMediaId !== undefined) {
    if (dados.avatarMediaId === null) {
      mudanca.avatarUrl = null
    } else {
      const midia = await prisma.mediaFile.findFirst({
        // Mesma loja de quem está trocando: sem isto, o id de uma imagem da
        // outra loja viraria a foto do perfil.
        where: { id: dados.avatarMediaId, fileType: "image", ...escopoDaLoja(usuario) },
        select: { fileUrl: true },
      })
      if (!midia) {
        return NextResponse.json({ error: "Imagem não encontrada." }, { status: 400 })
      }
      mudanca.avatarUrl = midia.fileUrl
    }
  }

  // Senha: a atual é conferida sempre. Sem isso, uma sessão esquecida aberta
  // no balcão trocaria a senha de quem a deixou aberta.
  if (dados.novaSenha) {
    const confere = await compare(dados.senhaAtual!, atual.passwordHash)
    if (!confere) {
      return NextResponse.json({ error: "Senha atual incorreta." }, { status: 403 })
    }
    if (await compare(dados.novaSenha, atual.passwordHash)) {
      return NextResponse.json({ error: "A nova senha é igual à atual." }, { status: 400 })
    }
    mudanca.passwordHash = await hash(dados.novaSenha, 12)
  }

  if (Object.keys(mudanca).length === 0) {
    return NextResponse.json({ error: "Nada a atualizar." }, { status: 400 })
  }

  const pessoa = await prisma.user.update({
    where: { id: usuario.id },
    data: mudanca,
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
  })

  // Troca de senha é evento de segurança: fica na trilha, sem o valor.
  if (mudanca.passwordHash) {
    await registrar({
      storeId: atual.storeId,
      userId: usuario.id,
      acao: "senha_alterada",
      entidade: "usuario",
      entidadeId: usuario.id,
      detalhes: { porOProprio: true },
      req,
    })
  }

  return NextResponse.json(pessoa)
}
