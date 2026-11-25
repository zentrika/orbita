"use client";

import { Award, Flame, MessageSquare, Paperclip, ShieldCheck, Timer, Trophy, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Empty, PageLoader } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { useMembers, useOrgId, usePerformance } from "@/lib/queries";
import { cn, fmtDate } from "@/lib/utils";

const KIND: Record<string, { label: string; icon: typeof MessageSquare }> = {
  comment: { label: "Comentarios técnicos", icon: MessageSquare },
  evidence: { label: "Evidencias adjuntas", icon: Paperclip },
  time_log: { label: "Registros de tiempo", icon: Timer },
  qa_submission: { label: "Entregas a QA", icon: Wrench },
  qa_review: { label: "Revisiones QA", icon: ShieldCheck },
};

function PerformanceView() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const userId = Number(params.get("user")) || me?.id || null;
  const { data, isLoading, error } = usePerformance(orgId, userId);
  const { data: members } = useMembers(orgId);
  const role = me?.organizations.find((o) => o.organization_id === orgId)?.role;
  const canPick = role === "owner" || role === "admin" || role === "pmo";

  return (
    <>
      <PageHeader
        title="Rendimiento"
        description="Contribuciones verificables y reconocimientos. Se otorgan por trabajo validado, nunca por estar asignado o reasignar tareas."
        actions={canPick && (
          <select className="input w-56" value={userId ?? ""} onChange={(e) => router.replace(`?user=${e.target.value}`)} aria-label="Persona">
            {members?.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.full_name}</option>)}
          </select>
        )}
      />
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8">
        {isLoading ? <PageLoader /> : error || !data ? (
          <div className="card"><Empty title="Sin acceso" description="Sólo la persona, su líder o la dirección pueden consultar este panel." /></div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar user={data.user} size={44} />
              <div><p className="font-display text-lg font-semibold">{data.user.full_name}</p><p className="text-xs text-ink-2">{data.user.email}</p></div>
            </div>
            <div className="card grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
              {[
                { l: "Resoluciones aceptadas", v: data.resolutions, icon: Trophy, c: "text-done" },
                { l: "Validaciones QA", v: data.validations, icon: ShieldCheck, c: "text-review" },
                { l: "Contribuciones", v: data.contributions, icon: MessageSquare, c: "text-progress" },
                { l: "Racha actual", v: data.current_streak, icon: Flame, c: "text-risk", s: "días laborales" },
                { l: "Mejor racha", v: data.best_streak, icon: Award, c: "text-ink-2", s: "días laborales" },
              ].map((k) => (
                <div key={k.l} className="px-5 py-4">
                  <p className="flex items-center gap-1.5 text-[13px] text-ink-2"><k.icon className={cn("h-3.5 w-3.5", k.c)} />{k.l}</p>
                  <p className="mt-1 font-display text-[26px] font-bold leading-none tabular-nums">{k.v}</p>
                  {k.s && <p className="mt-1 text-2xs text-ink-3">{k.s}</p>}
                </div>
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <section className="card p-5">
                <h2 className="mb-3 text-[15px] font-semibold">Contribuciones registradas</h2>
                <ul className="space-y-2.5">
                  {Object.entries(KIND).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-2.5 text-[13px]">
                      <v.icon className="h-4 w-4 text-ink-3" /><span className="flex-1">{v.label}</span>
                      <span className="font-medium tabular-nums">{data.contributions_by_kind[k] ?? 0}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-3">
                  Cuentan comentarios con contenido (no repetidos ni triviales), evidencias, tiempo registrado y entregas o revisiones de QA.
                  {data.last_contribution_day && ` Última contribución: ${fmtDate(data.last_contribution_day, "d MMM yyyy")}.`}
                  {" "}Fines de semana, festivos y ausencias autorizadas no rompen la racha.
                </p>
              </section>
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Historial de reconocimientos</h2>
                {data.achievements.length ? (
                  <ul className="divide-y divide-line">
                    {data.achievements.map((a) => (
                      <li key={a.id} className={cn("flex items-start gap-3 px-5 py-3 text-[13px]", a.status === "revoked" && "opacity-60")}>
                        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          a.kind === "resolution" ? "bg-done/10 text-done" : a.kind === "validation" ? "bg-review/10 text-review" : "bg-risk/10 text-risk")}>
                          {a.kind === "resolution" ? <Trophy className="h-3.5 w-3.5" /> : a.kind === "validation" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Flame className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={cn("font-medium", a.status === "revoked" && "line-through")}>{a.name}</p>
                          <p className="text-xs text-ink-2">{a.description}</p>
                          {a.task && (
                            <p className="mt-0.5 text-xs">
                              <Link href={`/o/${orgId}/projects/${a.project?.id}/board?task=${a.task.id}`} className="text-primary hover:underline">{a.task.key}</Link>
                              <span className="text-ink-2"> {a.task.title}</span>{a.team && <span className="text-ink-3"> · {a.team.name}</span>}
                            </p>
                          )}
                          {a.status === "revoked" && <p className="text-xs text-blocked">Revocado: {a.revoke_reason}</p>}
                        </div>
                        <span className="shrink-0 text-xs text-ink-3">{fmtDate(a.awarded_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <div className="p-5 text-sm text-ink-3">Aún no hay reconocimientos.</div>}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function PerformancePage() {
  return <Suspense><PerformanceView /></Suspense>;
}
