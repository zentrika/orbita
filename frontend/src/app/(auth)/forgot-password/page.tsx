"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Recupera tu contraseña</h1>
      {sent ? (
        <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          Si existe una cuenta con <strong className="text-ink">{email}</strong>, te enviamos un enlace para crear una nueva contraseña. El enlace caduca en 1 hora.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <p className="text-sm text-ink-2">Te enviaremos un enlace para restablecerla.</p>
          <Field label="Correo electrónico" htmlFor="email">
            <input id="email" type="email" required className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-[13px] text-blocked">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>Enviar enlace</Button>
        </form>
      )}
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link>
      </p>
    </>
  );
}
