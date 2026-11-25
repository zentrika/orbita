"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const { me, reload } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => {
        setState("ok");
        reload();
      })
      .catch((e) => {
        setState("error");
        setMsg((e as Error).message);
      });
  }, [token, reload]);

  return (
    <div>
      {state === "loading" && <Spinner />}
      {state === "ok" && (
        <>
          <h1 className="text-2xl font-semibold">Correo verificado</h1>
          <p className="mt-2 text-sm text-ink-2">Gracias por confirmar tu dirección.</p>
        </>
      )}
      {state === "error" && (
        <>
          <h1 className="text-2xl font-semibold">No pudimos verificar el correo</h1>
          <p className="mt-2 text-sm text-ink-2">{msg}</p>
        </>
      )}
      <Link href={me ? "/" : "/login"} className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover">
        Continuar
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
