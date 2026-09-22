import { type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { prisma } from "@/lib/db/prisma"

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user || !user.isActive) {
          return null
        }

        const isValid = await compare(credentials.password, user.passwordHash)
        if (!isValid) {
          return null
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          // A loja do vendedor sai do cadastro, nunca do cliente. Nulo = gestao
          // (admin/gerente), que alcanca as duas lojas.
          storeId: user.storeId,
          image: user.avatarUrl,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as unknown as { role: string; storeId: string | null }
        token.id = user.id
        token.role = u.role
        token.storeId = u.storeId
      }
      // Trocou nome ou foto em "Minha conta": sem reler aqui, o canto da tela
      // so mudaria no proximo login. Papel e loja NAO sao relidos de proposito
      // — trocar papel e ato de administracao, e a sessao acompanha no login.
      if (trigger === "update" && token.id) {
        const atual = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { name: true, avatarUrl: true },
        })
        if (atual) {
          token.name = atual.name
          token.picture = atual.avatarUrl
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.storeId = (token.storeId as string | null) ?? null
      }
      return session
    },
  },
}
