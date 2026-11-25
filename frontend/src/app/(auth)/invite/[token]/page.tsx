"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/utils";

interface Preview { organization_name: string; email: string; role: string; expired: boolean; accepted: boolean; user_exists: boolean }

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { me, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<Preview>(`/invitations/${token}`),
    retry: false,
  });

  if (isLoading || authLoading) return <PageLoader />;
  if (error || !data) return <><h1 className="text-2xl font-semibold">Invitación no válida</h1><p className="mt-2 text-sm text-ink-2">El enlace no existe o fue revocado.</p></>;

  const unusable = data.expired || data.accepted;
  const accept = async () => {
    setAccepting(true);
    try {
      const m = await api<Me>(`/invitations/${token}/accept`, { method: "POST" });
      const org = m.organizations.find((o) => o.name === data.organization_name) ?? m.organizations[0];
      toast.success(`Te uniste a ${data.organization_name}`);
      window.location.href = `/o/${org.organization_id}`;
    } catch (e) {
      toast.error((e as Error).message);
      setAccepting(false);
    }
  };

  return (
    <>
      <p className="text-sm font-medium text-primary">Invitación</p>
      <h1 className="mt-1 text-2xl font-semibold">Únete a {data.organization_name}</h1>
      <p className="mt-2 text-sm text-ink-2">
        Te invitaron como <strong className="text-ink">{ROLE_LABEL[data.role]}</strong> con el correo {data.email}.
      </p>
      {unusable ? (
        <p className="mt-6 rounded-lg bg-risk/10 px-3 py-2 text-sm text-[#B54708]">
          {data.accepted ? "Esta invitación ya fue aceptada." : "Esta invitación ha caducado. Pide una nueva."}
        </p>
      ) : me ? (
        me.email.toLowerCase() === data.email.toLowerCase() ? (
          <Button size="lg" className="mt-8 w-full" onClick={accept} loading={accepting}>Aceptar invitación</Button>
        ) : (
          <div className="mt-6 space-y-3 text-sm text-ink-2">
            <p>Has iniciado sesión como <strong className="text-ink">{me.email}</strong>. Inicia sesión con {data.email} para aceptar.</p>
            <Button variant="secondary" onClick={logout}>Cambiar de cuenta</Button>
          </div>
        )
      ) : data.user_exists ? (
        <Button size="lg" className="mt-8 w-full" onClick={() => router.push(`/login?next=/invite/${token}`)}>Inicia sesión para aceptar</Button>
      ) : (
        <Link href={`/register?invitation=${token}&email=${encodeURIComponent(data.email)}`} className="mt-8 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover">
          Crear cuenta y unirme
        </Link>
      )}
    </>
  );
}
