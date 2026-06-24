import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Arbiter",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = (credentials?.username ?? "").trim().toLowerCase();
        const password = credentials?.password ?? "";
        if (!username || !password) return null;

        try {
          const sql = getDb();
          const rows = await sql`
            SELECT id, username, password_hash
            FROM users
            WHERE LOWER(username) = ${username}
            LIMIT 1
          ` as { id: number; username: string; password_hash: string }[];

          if (!rows.length) return null;
          const user = rows[0];

          const valid = await bcrypt.compare(password, user.password_hash);
          if (!valid) return null;

          return { id: String(user.id), name: user.username, username: user.username };
        } catch {
          return null;
        }
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId   = user.id;
        token.username = (user as { username?: string }).username ?? user.name ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id       = token.userId;
      session.user.username = token.username;
      return session;
    },
  },
};

export const { handlers } = NextAuth(authOptions);
