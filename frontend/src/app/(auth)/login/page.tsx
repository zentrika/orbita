"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const me = await login(email, password);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) router.replace(next);
      else router.replace(me.organizations.length ? `/o/${me.organizations[0].organization_id}` : "/onboarding");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Inicia sesión</h1>
      <p className="mt-1.5 text-sm text-ink-2">Bienvenido de nuevo. Continúa donde lo dejaste.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Correo electrónico" htmlFor="email">
          <input id="email" type="email" required autoComplete="email" className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-medium">Contraseña</label>
            <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">¿La olvidaste?</Link>
          </div>
          <input id="password" type="password" required autoComplete="current-password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-lg bg-blocked/10 px-3 py-2 text-[13px] text-blocked">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>Entrar</Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-2">
        ¿No tienes cuenta? <Link href="/register" className="font-medium text-primary hover:underline">Crea tu espacio</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
