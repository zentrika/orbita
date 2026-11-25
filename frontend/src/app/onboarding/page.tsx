"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Field, PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Org } from "@/lib/types";

export default function Onboarding() {
  const { me, loading, reload, logout } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);
  if (loading || !me) return <PageLoader />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const org = await api<Org>("/orgs", { method: "POST", body: { name } });
      await reload();
      router.replace(`/o/${org.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Logo className="mb-10" />
        <h1 className="text-2xl font-semibold">Crea tu organización</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          Una organización agrupa a tu equipo, proyectos y permisos. Si te invitaron a una, abre el enlace del correo.
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Nombre de la empresa" htmlFor="org">
            <input id="org" required minLength={2} className="input h-10" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {error && <p className="text-[13px] text-blocked">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Continuar</Button>
        </form>
        <button onClick={logout} className="mt-6 text-sm text-ink-2 hover:text-ink">Cerrar sesión</button>
      </div>
    </div>
  );
}
