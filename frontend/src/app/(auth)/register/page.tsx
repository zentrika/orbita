"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";

function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const invitation = params.get("invitation") ?? undefined;
  const [form, setForm] = useState({ full_name: "", email: params.get("email") ?? "", password: "", organization_name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const me = await register({
        ...form,
        organization_name: invitation ? undefined : form.organization_name || undefined,
        invitation_token: invitation,
      });
      router.replace(me.organizations.length ? `/o/${me.organizations[0].organization_id}` : "/onboarding");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{invitation ? "Únete a tu equipo" : "Crea tu espacio de trabajo"}</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        {invitation ? "Crea tu cuenta para aceptar la invitación." : "Empieza gratis. Podrás invitar a tu equipo después."}
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Nombre completo" htmlFor="name">
          <input id="name" required minLength={2} autoComplete="name" className="input h-10" value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Correo de trabajo" htmlFor="email">
          <input id="email" type="email" required autoComplete="email" readOnly={!!params.get("email")} className="input h-10" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Contraseña" htmlFor="password" hint="Mínimo 8 caracteres, con letras y números.">
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="input h-10" value={form.password} onChange={set("password")} />
        </Field>
        {!invitation && (
          <Field label="Nombre de la empresa" htmlFor="org">
            <input id="org" required minLength={2} placeholder="Acme S.A." className="input h-10" value={form.organization_name} onChange={set("organization_name")} />
          </Field>
        )}
        {error && <p role="alert" className="rounded-lg bg-blocked/10 px-3 py-2 text-[13px] text-blocked">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {invitation ? "Crear cuenta y unirme" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-2">
        ¿Ya tienes cuenta? <Link href="/login" className="font-medium text-primary hover:underline">Inicia sesión</Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
