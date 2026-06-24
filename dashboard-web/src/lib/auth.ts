import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Arbiter",
      credentials: {
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const pw = process.env.DASHBOARD_PASSWORD;
        if (!pw || !credentials?.password) return null;
        if (!timingSafeEqual(String(credentials.password), pw)) return null;
        return { id: "admin", name: "Admin" };
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token }) { return token; },
    async session({ session }) { return session; },
  },
};

export const { handlers } = NextAuth(authOptions);
