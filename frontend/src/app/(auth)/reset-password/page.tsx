"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { api } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Las contraseñas no coinciden");
    setLoading(true);
    setError("");
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (done)
    return (
      <>
        <h1 className="text-2xl font-semibold">Contraseña actualizada</h1>
        <p className="mt-2 text-sm text-ink-2">Cerramos tus otras sesiones por seguridad.</p>
        <Link href="/login" className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover">
          Iniciar sesión
        </Link>
      </>
    );

  return (
    <>
      <h1 className="text-2xl font-semibold">Nueva contraseña</h1>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Contraseña" htmlFor="p1" hint="Mínimo 8 caracteres, con letras y números.">
          <input id="p1" type="password" required minLength={8} autoComplete="new-password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repite la contraseña" htmlFor="p2">
          <input id="p2" type="password" required className="input h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-[13px] text-blocked">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!token}>Guardar contraseña</Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
