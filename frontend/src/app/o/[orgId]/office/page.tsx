"use client";

import * as P from "@radix-ui/react-popover";
import { Award, Crown, Flame, ShieldCheck, Wifi, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PriorityIcon } from "@/components/tasks/bits";
import { CapacityMeter } from "@/components/tasks/task-workflow";
import { Avatar, Empty, PageLoader, Spinner } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { useOffice, useOrgId, usePerformance } from "@/lib/queries";
import type { OfficeMember, OfficeTeam } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";

function Presence({ online, className }: { online: boolean; className?: string }) {
  return (
    <span className={cn("block h-2.5 w-2.5 rounded-full ring-2 ring-surface", online ? "bg-done" : "bg-line-strong", className)}
      aria-label={online ? "En línea" : "Desconectado"} />
  );
}

/** Puesto de trabajo: avatar, presencia y ocupación (tareas en progreso / capacidad). */
function Desk({ m, onSelect }: { m: OfficeMember; onSelect: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className="group/desk relative flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface px-2 pb-2 pt-3 text-center transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-sm"
      aria-label={`${m.user.full_name}, ${m.online ? "en línea" : "desconectado"}, ${m.in_progress} de ${m.capacity} en progreso`}
    >
      <span className="relative">
        <Avatar user={m.user} size={34} className={cn(!m.online && "grayscale-[60%] opacity-70")} />
        <Presence online={m.online} className="absolute -bottom-0.5 -right-0.5" />
        {m.is_lead && <Crown className="absolute -left-1.5 -top-1.5 h-3.5 w-3.5 rotate-[-20deg] fill-risk text-risk" aria-label="Líder" />}
      </span>
      <span className="w-full truncate text-[11.5px] font-medium">{m.user.full_name.split(" ")[0]}</span>
      <CapacityMeter used={m.in_progress} total={m.capacity} compact />
    </button>
  );
}

function TeamSummary({ team }: { team: OfficeTeam }) {
  return (
    <div className="w-80 space-y-3 text-[13px]">
      <div>
        <p className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: team.color }} />{team.name}
          {team.is_qa && <span className="chip h-5 bg-review/10 px-1.5 text-2xs text-review">QA</span>}
        </p>
        <p className="mt-0.5 text-xs text-ink-2">Líder: {team.lead?.full_name ?? "sin líder"} · {team.members.length} integrantes</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-subtle py-2"><p className="text-base font-semibold">{team.online}</p><p className="text-2xs text-ink-2">en línea</p></div>
        <div className="rounded-lg bg-subtle py-2"><p className="text-base font-semibold">{team.pending}</p><p className="text-2xs text-ink-2">pendientes</p></div>
        <div className="rounded-lg bg-subtle py-2"><p className="text-base font-semibold text-progress">{team.in_progress}</p><p className="text-2xs text-ink-2">en progreso</p></div>
      </div>
      <ul className="space-y-2">
        {team.members.map((m) => (
          <li key={m.user.id} className="flex items-start gap-2">
            <Presence online={m.online} className="mt-1.5 ring-0" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium">{m.user.full_name}{m.is_lead && <Crown className="h-3 w-3 text-risk" />}
                <span className="ml-auto text-2xs font-normal text-ink-3">{m.online ? "en línea" : m.last_seen ? `visto ${fmtRelative(new Date(m.last_seen * 1000).toISOString())}` : "desconectado"}</span>
              </p>
              {m.active_tasks.length ? m.active_tasks.slice(0, 2).map((t) => (
                <p key={t.id} className="truncate text-xs text-ink-2"><span className="text-ink-3">{t.key}</span> {t.title}</p>
              )) : <p className="text-xs text-ink-3">{m.in_progress ? `${m.in_progress} en progreso` : "Sin tareas en ejecución"}</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-ink-3">Pulsa la sala para ver el detalle.</p>
    </div>
  );
}

function Room({ team, onOpen, onMember }: { team: OfficeTeam; onOpen: () => void; onMember: (m: OfficeMember) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enter = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 250); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150); };
  const cols = team.members.length > 6 ? "grid-cols-4" : "grid-cols-3";
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="group relative flex cursor-pointer flex-col rounded-xl border-2 bg-surface/80 p-3 transition-shadow hover:shadow-md focus-visible:shadow-md"
          style={{ borderColor: `${team.color}55` }}
          aria-label={`Sala de ${team.name}`}
        >
          {/* Puerta y rótulo de la sala */}
          <span className="absolute -bottom-[2px] left-6 h-[3px] w-10 bg-bg" aria-hidden />
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: team.color }}>{team.name}</span>
            {team.is_qa && <ShieldCheck className="h-3.5 w-3.5 text-review" aria-label="Equipo QA" />}
            <span className="ml-auto flex items-center gap-1 text-2xs text-ink-2"><Wifi className="h-3 w-3 text-done" />{team.online}/{team.members.length}</span>
          </div>
          <div className={cn("grid gap-2", cols)}>
            {team.members.map((m) => <Desk key={m.user.id} m={m} onSelect={() => onMember(m)} />)}
          </div>
          {!team.members.length && <p className="py-6 text-center text-xs text-ink-3">Sala vacía</p>}
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content side="right" align="start" sideOffset={10} collisionPadding={16} onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={enter} onMouseLeave={leave}
          className="z-40 hidden animate-pop-in rounded-xl border border-line bg-surface p-4 shadow-lg md:block">
          <TeamSummary team={team} />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function MemberAchievements({ orgId, member }: { orgId: number; member: OfficeMember }) {
  const { data, isLoading, error } = usePerformance(orgId, member.user.id);
  if (isLoading) return <Spinner className="h-4 w-4" />;
  if (error || !data) return <p className="text-xs text-ink-3">Sólo la persona, su líder o la dirección pueden ver sus reconocimientos.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-center">
        {[["Resoluciones", data.resolutions], ["Validaciones", data.validations], ["Contribuciones", data.contributions], ["Racha", data.current_streak]].map(([l, v]) => (
          <div key={l as string} className="rounded-lg bg-subtle py-1.5"><p className="text-sm font-semibold">{v}</p><p className="text-[10px] text-ink-2">{l}</p></div>
        ))}
      </div>
      {data.achievements.filter((a) => a.status === "active").slice(0, 3).map((a) => (
        <p key={a.id} className="flex items-center gap-2 text-xs"><Award className="h-3.5 w-3.5 text-risk" />{a.name}
          {a.task && <span className="truncate text-ink-3">· {a.task.key}</span>}</p>
      ))}
      <Link href={`/o/${orgId}/performance?user=${member.user.id}`} className="inline-block text-xs font-medium text-primary hover:underline">Ver panel de rendimiento</Link>
    </div>
  );
}

function TeamDetail({ orgId, team, focus, onClose }: { orgId: number; team: OfficeTeam; focus: number | null; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(focus);
  return (
    <>
      <div className="fixed inset-0 z-30 bg-[#0C111D]/20" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full animate-slide-in flex-col border-l border-line bg-surface shadow-lg sm:w-[440px]" aria-label={`Detalle de ${team.name}`}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-5" style={{ boxShadow: `inset 0 3px 0 ${team.color}` }}>
          <span className="font-display text-[15px] font-semibold">{team.name}</span>
          {team.is_qa && <span className="chip h-5 bg-review/10 px-1.5 text-2xs text-review">QA</span>}
          <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-ink-3 hover:bg-subtle" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
          {team.members.map((m) => (
            <div key={m.user.id} className={cn("rounded-xl border p-3 transition-colors", selected === m.user.id ? "border-primary/40 bg-primary-soft/40" : "border-line")}>
              <button className="flex w-full items-center gap-3 text-left" onClick={() => setSelected(selected === m.user.id ? null : m.user.id)}>
                <span className="relative"><Avatar user={m.user} size={32} /><Presence online={m.online} className="absolute -bottom-0.5 -right-0.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-medium">{m.user.full_name}{m.is_lead && <Crown className="h-3 w-3 text-risk" />}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-2">{m.online ? <><Wifi className="h-3 w-3 text-done" />En línea</> : <><WifiOff className="h-3 w-3" />Desconectado</>} · {m.pending} pendientes</span>
                </span>
                <CapacityMeter used={m.in_progress} total={m.capacity} />
              </button>
              {m.active_tasks.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2">
                  {m.active_tasks.map((t) => (
                    <li key={t.id}>
                      <Link href={`/o/${orgId}/projects/${t.project_id}/board?task=${t.id}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-subtle">
                        <PriorityIcon priority={t.priority} /><span className="text-ink-3">{t.key}</span><span className="truncate">{t.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {m.in_progress > m.active_tasks.length && (
                <p className="mt-1 text-2xs text-ink-3">{m.in_progress - m.active_tasks.length} en proyectos que no puedes ver.</p>
              )}
              {selected === m.user.id && <div className="mt-3 border-t border-line pt-3"><MemberAchievements orgId={orgId} member={m} /></div>}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

export default function OfficePage() {
  const orgId = useOrgId();
  const { data, isLoading } = useOffice(orgId);
  const { me } = useAuth();
  const [detail, setDetail] = useState<{ teamId: number; focus: number | null } | null>(null);
  if (isLoading || !data) return <PageLoader />;
  const team = data.teams.find((t) => t.id === detail?.teamId);
  const online = data.teams.reduce((n, t) => n + t.online, 0);
  const isAdmin = ["owner", "admin"].includes(me?.organizations.find((o) => o.organization_id === orgId)?.role ?? "");

  return (
    <>
      <PageHeader title="Oficina virtual" description={`${online} personas en línea · capacidad de ${data.wip_limit} tareas en progreso por persona`} />
      <div className="px-4 py-6 sm:px-8">
        {!data.teams.length ? (
          <div className="card"><Empty title="Todavía no hay equipos" description="Crea equipos (Team 404, QA, Soporte…) para ver su sala en la oficina."
            action={isAdmin && <Link href={`/o/${orgId}/team`} className="text-sm font-medium text-primary hover:underline">Crear equipos</Link>} /></div>
        ) : (
          <div
            className="rounded-2xl border border-line p-4 sm:p-6"
            style={{ backgroundImage: "radial-gradient(rgb(var(--line-strong) / 0.55) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
          >
            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {data.teams.map((t) => (
                <Room key={t.id} team={t} onOpen={() => setDetail({ teamId: t.id, focus: null })} onMember={(m) => setDetail({ teamId: t.id, focus: m.user.id })} />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-dashed border-line-strong pt-4 text-xs text-ink-2">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-done" />En línea</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-line-strong" />Desconectado</span>
              <span className="inline-flex items-center gap-1.5"><Crown className="h-3 w-3 fill-risk text-risk" />Líder</span>
              <span className="inline-flex items-center gap-1.5"><CapacityMeter used={2} total={data.wip_limit} compact />Tareas en progreso / capacidad</span>
              {!!data.unassigned_online.length && (
                <span className="ml-auto inline-flex items-center gap-2"><Flame className="h-3 w-3" />En línea sin equipo:
                  <span className="flex -space-x-1.5">{data.unassigned_online.map((u) => <Avatar key={u.id} user={u} size={20} />)}</span></span>
              )}
            </div>
          </div>
        )}
      </div>
      {team && <TeamDetail orgId={orgId} team={team} focus={detail!.focus} onClose={() => setDetail(null)} />}
    </>
  );
}
