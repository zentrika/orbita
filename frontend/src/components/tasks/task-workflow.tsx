"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Crown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Field, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useInvalidateTasks } from "@/lib/queries";
import type { AssignmentHistory, Cycle, EligibleAssignee, TaskDetail, TeamBrief, TeamTransfer } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";

/** Capacidad en progreso como 0/4 … 4/4 con barra segmentada. */
export function CapacityMeter({ used, total, compact }: { used: number; total: number; compact?: boolean }) {
  const full = used >= total;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${used} de ${total} tareas en progreso`}>
      <span className="flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn("h-2 rounded-sm", compact ? "w-1.5" : "w-2.5", i < used ? (full ? "bg-risk" : "bg-progress") : "bg-subtle ring-1 ring-inset ring-line")} />
        ))}
      </span>
      <span className={cn("text-xs tabular-nums", full ? "font-semibold text-[#B54708] dark:text-risk" : "text-ink-2")}>{used}/{total}</span>
    </span>
  );
}

export function AssignDialog({ orgId, task, onClose }: { orgId: number; task: TaskDetail; onClose: () => void }) {
  const invalidate = useInvalidateTasks(orgId);
  const { data, isLoading } = useQuery({
    queryKey: ["eligible", orgId, task.id],
    queryFn: () => api<EligibleAssignee[]>(`/orgs/${orgId}/tasks/${task.id}/eligible-assignees`),
  });
  const [selected, setSelected] = useState<number | null>(task.assignee?.id ?? null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const inProgress = task.status?.category === "in_progress";

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/tasks/${task.id}/assign`, { method: "POST", body: { assignee_id: selected, reason } });
      toast.success(selected ? "Tarea reasignada" : "Responsable retirado");
      invalidate(task.id);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={`Reasignar ${task.key}`}
      description={task.team ? `Sólo integrantes de ${task.team.name}. Se muestra su carga pendiente y su capacidad en progreso.` : "Personas con acceso al proyecto."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} loading={busy} disabled={selected === (task.assignee?.id ?? null)}>Confirmar</Button></>}>
      {isLoading ? <Spinner /> : (
        <div className="space-y-4">
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Responsable">
            {data?.map((e) => {
              const blocked = inProgress && e.at_capacity && e.user.id !== task.assignee?.id;
              return (
                <li key={e.user.id}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-muted", selected === e.user.id && "bg-primary-soft", blocked && "cursor-not-allowed opacity-50")}>
                    <input type="radio" name="assignee" className="accent-primary" disabled={blocked} checked={selected === e.user.id} onChange={() => setSelected(e.user.id)} />
                    <Avatar user={e.user} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">{e.user.full_name}{e.is_lead && <Crown className="h-3 w-3 text-risk" aria-label="Líder" />}
                        {e.user.id === task.assignee?.id && <span className="text-2xs font-normal text-ink-3">(actual)</span>}</span>
                      <span className="text-xs text-ink-2">{e.pending} pendientes</span>
                    </span>
                    <CapacityMeter used={e.in_progress} total={e.capacity} />
                  </label>
                </li>
              );
            })}
            <li>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] text-ink-2 hover:bg-muted">
                <input type="radio" name="assignee" className="accent-primary" checked={selected === null} onChange={() => setSelected(null)} />
                <Avatar user={null} size={26} /> Sin asignar
              </label>
            </li>
          </ul>
          {inProgress && <p className="text-xs text-ink-2">La tarea está en progreso: no se puede entregar a quien ya tiene su capacidad completa.</p>}
          <Field label="Motivo (queda en el historial)" htmlFor="as-reason">
            <input id="as-reason" maxLength={500} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: Juan tiene menos carga" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function TransferDialog({ orgId, task, teams, onClose }: { orgId: number; task: TaskDetail; teams: TeamBrief[]; onClose: () => void }) {
  const invalidate = useInvalidateTasks(orgId);
  const options = teams.filter((t) => t.id !== task.team_id);
  const [teamId, setTeamId] = useState<number | null>(options[0]?.id ?? null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/tasks/${task.id}/transfer`, { method: "POST", body: { team_id: teamId, reason } });
      toast.success("Tarea transferida");
      invalidate(task.id);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Transferir ${task.key} a otro equipo`}
      description="El líder del equipo receptor podrá asignarla. Tu equipo deja de poder reasignarla."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="transfer" loading={busy} disabled={!teamId}>Transferir</Button></>}>
      {options.length === 0 ? <p className="text-sm text-ink-2">No hay otros equipos con acceso a este proyecto.</p> : (
        <form id="transfer" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {options.map((t) => (
              <button type="button" key={t.id} onClick={() => setTeamId(t.id)}
                className={cn("flex items-center gap-2 rounded-lg border p-3 text-left text-[13px]", teamId === t.id ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong")}>
                <span className="h-3 w-3 rounded" style={{ background: t.color }} />
                <span className="font-medium">{t.name}</span>{t.is_qa && <span className="ml-auto text-2xs text-ink-3">QA</span>}
              </button>
            ))}
          </div>
          <Field label="Motivo" htmlFor="tr-reason">
            <input id="tr-reason" required minLength={3} maxLength={500} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </form>
      )}
    </Dialog>
  );
}

export function QADialog({ orgId, task, mode, onClose }: { orgId: number; task: TaskDetail; mode: "submit" | "approve" | "reject"; onClose: () => void }) {
  const invalidate = useInvalidateTasks(orgId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const cfg = {
    submit: { title: "Enviar a QA", label: "Qué entregas y cómo probarlo", cta: "Enviar a QA", hint: "Se abre un ciclo de revisión. Los reconocimientos sólo llegan si QA valida tu entrega." },
    approve: { title: "Validar entrega", label: "Evidencia de la validación", cta: "Validar y finalizar", hint: "Describe qué probaste. Sin evidencia no se registra la validación." },
    reject: { title: "Rechazar entrega", label: "Qué falló", cta: "Rechazar", hint: "La tarea vuelve a desarrollo y el líder del equipo recibe el aviso." },
  }[mode];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "submit") await api(`/orgs/${orgId}/tasks/${task.id}/submit-qa`, { method: "POST", body: { note: text } });
      else await api(`/orgs/${orgId}/tasks/${task.id}/qa-review`, { method: "POST", body: { approve: mode === "approve", evidence: text } });
      toast.success(mode === "submit" ? "Enviada a QA" : mode === "approve" ? "Entrega validada" : "Entrega rechazada");
      invalidate(task.id);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={cfg.title} description={cfg.hint}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="qa-form" loading={busy} variant={mode === "reject" ? "danger" : "primary"}>{cfg.cta}</Button></>}>
      <form id="qa-form" onSubmit={submit}>
        <Field label={cfg.label} htmlFor="qa-text" hint="Mínimo 10 caracteres.">
          <textarea id="qa-text" required minLength={10} rows={4} className="input h-auto py-2" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

const CYCLE: Record<Cycle["status"], { label: string; cls: string }> = {
  in_qa: { label: "En QA", cls: "bg-review/10 text-review" },
  accepted: { label: "Validada", cls: "bg-done/10 text-done" },
  rejected: { label: "Rechazada", cls: "bg-blocked/10 text-blocked" },
  revoked: { label: "Revocada (reabierta)", cls: "bg-subtle text-ink-2" },
};

export function TaskHistory({ orgId, taskId }: { orgId: number; taskId: number }) {
  const assign = useQuery({ queryKey: ["task", orgId, taskId, "assignments"], queryFn: () => api<AssignmentHistory[]>(`/orgs/${orgId}/tasks/${taskId}/assignment-history`) });
  const transfers = useQuery({ queryKey: ["task", orgId, taskId, "transfers"], queryFn: () => api<TeamTransfer[]>(`/orgs/${orgId}/tasks/${taskId}/transfers`) });
  const cycles = useQuery({ queryKey: ["task", orgId, taskId, "cycles"], queryFn: () => api<Cycle[]>(`/orgs/${orgId}/tasks/${taskId}/cycles`) });
  if (assign.isLoading || transfers.isLoading || cycles.isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Ciclos de QA</h4>
        {cycles.data?.length ? (
          <ol className="space-y-2">
            {cycles.data.map((c) => (
              <li key={c.id} className="rounded-lg border border-line p-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <strong>Ciclo {c.number}</strong><span className={cn("chip h-5 px-1.5 text-2xs", CYCLE[c.status].cls)}>{CYCLE[c.status].label}</span>
                  <span className="ml-auto text-xs text-ink-3">{fmtRelative(c.submitted_at)}</span>
                </div>
                <p className="mt-1 text-ink-2"><span className="font-medium text-ink">{c.submitted_by?.full_name}</span> entregó: {c.submission_note}</p>
                {c.reviewed_by && <p className="mt-1 text-ink-2"><span className="font-medium text-ink">{c.reviewed_by.full_name}</span> (QA): {c.review_note}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-[13px] text-ink-3">Aún no se ha enviado a QA.</p>}
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Reasignaciones</h4>
        {assign.data?.length ? (
          <ol className="space-y-2.5">
            {assign.data.map((h) => (
              <li key={h.id} className="flex items-start gap-2.5 text-[13px]">
                <Avatar user={h.changed_by} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{h.from_user?.full_name ?? "Sin asignar"}</span><ArrowRight className="h-3 w-3 text-ink-3" />
                    <span className="font-medium">{h.to_user?.full_name ?? "Sin asignar"}</span>
                    <span className="text-xs text-ink-3">· {h.changed_by?.full_name} · {fmtRelative(h.created_at)}</span>
                  </p>
                  {h.reason && <p className="text-xs text-ink-2">{h.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="text-[13px] text-ink-3">Sin reasignaciones.</p>}
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Transferencias entre equipos</h4>
        {transfers.data?.length ? (
          <ol className="space-y-2.5">
            {transfers.data.map((t) => (
              <li key={t.id} className="text-[13px]">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{t.from_team?.name ?? "Sin equipo"}</span><ArrowRight className="h-3 w-3 text-ink-3" />
                  <span className="font-medium">{t.to_team?.name}</span>
                  <span className="text-xs text-ink-3">· {t.transferred_by?.full_name} · {fmtRelative(t.created_at)}</span>
                </p>
                <p className="text-xs text-ink-2">{t.reason}</p>
              </li>
            ))}
          </ol>
        ) : <p className="text-[13px] text-ink-3">Sin transferencias.</p>}
      </section>
    </div>
  );
}
