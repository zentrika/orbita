"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Empty, Field, PageLoader, Segmented } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useEditRequests, useOrgId } from "@/lib/queries";
import type { EditRequest } from "@/lib/types";
import { cn, fmtDate, fmtRelative } from "@/lib/utils";

const plain = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

/** Diferencia palabra a palabra (LCS) para comparar el comentario original con el propuesto. */
function wordDiff(a: string, b: string) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const n = x.length, m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: string; k: "same" | "del" | "add" }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: x[i], k: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: x[i++], k: "del" });
    else out.push({ t: y[j++], k: "add" });
  }
  while (i < n) out.push({ t: x[i++], k: "del" });
  while (j < m) out.push({ t: y[j++], k: "add" });
  return out;
}

const STATUS = {
  pending: { label: "Pendiente", cls: "bg-risk/10 text-[#B54708] dark:text-risk" },
  approved: { label: "Aprobada", cls: "bg-done/10 text-done" },
  rejected: { label: "Rechazada", cls: "bg-blocked/10 text-blocked" },
};

function RequestCard({ r, orgId, onDecide }: { r: EditRequest; orgId: number; onDecide: (r: EditRequest, approve: boolean) => void }) {
  const diff = useMemo(() => wordDiff(plain(r.original_body), plain(r.proposed_body)), [r]);
  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 text-[13px]">
        <Avatar user={r.requester} size={26} />
        <span><strong>{r.requester?.full_name}</strong> <span className="text-ink-2">pide editar su comentario</span></span>
        <span className={cn("chip h-5 px-1.5 text-2xs", STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
        <span className="ml-auto text-xs text-ink-3">{fmtRelative(r.created_at)}</span>
      </header>
      <div className="grid gap-4 px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <div><dt className="text-ink-3">Proyecto</dt><dd className="font-medium">{r.project.name}</dd></div>
          <div><dt className="text-ink-3">Equipo</dt><dd className="flex items-center gap-1.5 font-medium">{r.team ? <><span className="h-2 w-2 rounded-full" style={{ background: r.team.color }} />{r.team.name}</> : "—"}</dd></div>
          <div><dt className="text-ink-3">Tarea</dt><dd><Link href={`/o/${orgId}/projects/${r.task.project_id}/board?task=${r.task.id}`} className="font-medium text-primary hover:underline">{r.task.key}</Link> <span className="text-ink-2">{r.task.title}</span></dd></div>
          <div><dt className="text-ink-3">Aprueba</dt><dd className="font-medium">{r.approver?.full_name ?? "Administración"}</dd></div>
        </dl>
        <div className="rounded-lg bg-subtle px-3 py-2 text-[13px]"><span className="text-ink-2">Motivo:</span> {r.reason}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-3">Comentario original</p>
            <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-[13px] leading-6">
              {diff.filter((d) => d.k !== "add").map((d, i) => <span key={i} className={cn(d.k === "del" && "rounded bg-blocked/15 text-blocked line-through")}>{d.t}</span>)}
            </p>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-3">Propuesta</p>
            <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-[13px] leading-6">
              {diff.filter((d) => d.k !== "del").map((d, i) => <span key={i} className={cn(d.k === "add" && "rounded bg-done/15 text-[#027A48] dark:text-done")}>{d.t}</span>)}
            </p>
          </div>
        </div>
        {r.status !== "pending" && (
          <p className="text-xs text-ink-2">
            {r.status === "approved" ? "Aprobada" : "Rechazada"} por <strong className="text-ink">{r.decided_by?.full_name}</strong> el {fmtDate(r.decided_at, "d MMM yyyy, HH:mm")}
            {r.decision_note && <> · «{r.decision_note}»</>}
          </p>
        )}
      </div>
      {r.can_decide && (
        <footer className="flex justify-end gap-2 border-t border-line bg-muted/60 px-5 py-3">
          <Button variant="secondary" onClick={() => onDecide(r, false)}><X className="h-4 w-4" /> Rechazar</Button>
          <Button onClick={() => onDecide(r, true)}><Check className="h-4 w-4" /> Aprobar</Button>
        </footer>
      )}
    </article>
  );
}

export default function ApprovalsPage() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const role = me?.organizations.find((o) => o.organization_id === orgId)?.role;
  const isManager = role === "owner" || role === "admin" || role === "pmo";
  const [tab, setTab] = useState<"inbox" | "mine" | "all">(isManager && role === "pmo" ? "all" : "inbox");
  const { data, isLoading } = useEditRequests(orgId, tab, tab !== "all" || isManager);
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState<{ r: EditRequest; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!deciding) return;
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/comment-edit-requests/${deciding.r.id}/decision`, { method: "POST", body: { approve: deciding.approve, note } });
      toast.success(deciding.approve ? "Edición aprobada: el comentario se actualizó" : "Solicitud rechazada");
      qc.invalidateQueries({ queryKey: ["edit-requests", orgId] });
      qc.invalidateQueries({ queryKey: ["comments", orgId, deciding.r.task.id] });
      setDeciding(null);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  const pending = data?.filter((r) => r.status === "pending") ?? [];
  const resolved = data?.filter((r) => r.status !== "pending") ?? [];

  return (
    <>
      <PageHeader title="Aprobaciones" description="Los comentarios no se editan directamente: el líder del equipo aprueba cada cambio y se conserva la versión original.">
        <div className="pb-3">
          <Segmented value={tab} onChange={setTab} options={[
            { value: "inbox", label: "Por aprobar" },
            { value: "mine", label: "Mis solicitudes" },
            ...(isManager ? [{ value: "all" as const, label: "Seguimiento" }] : []),
          ]} />
        </div>
      </PageHeader>
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-8">
        {tab === "all" && <p className="text-[13px] text-ink-2">Vista de seguimiento: consulta el historial de todas las solicitudes. Las decide el líder de cada equipo.</p>}
        {isLoading ? <PageLoader /> : !data?.length ? (
          <div className="card"><Empty title={tab === "inbox" ? "Nada por aprobar" : "Sin solicitudes"} description={tab === "inbox" ? "Cuando alguien de tu equipo pida editar un comentario aparecerá aquí." : undefined} /></div>
        ) : (
          <>
            {pending.map((r) => <RequestCard key={r.id} r={r} orgId={orgId} onDecide={(rr, a) => setDeciding({ r: rr, approve: a })} />)}
            {!!resolved.length && <h2 className="flex items-center gap-2 pt-4 text-[13px] font-semibold text-ink-2">Resueltas <ArrowRight className="h-3 w-3" /></h2>}
            {resolved.map((r) => <RequestCard key={r.id} r={r} orgId={orgId} onDecide={() => {}} />)}
          </>
        )}
      </div>
      <Dialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)} size="sm"
        title={deciding?.approve ? "¿Aprobar la edición?" : "¿Rechazar la solicitud?"}
        description={deciding?.approve ? "El comentario se actualizará y la versión original quedará guardada." : "El comentario se mantendrá como está."}
        footer={<><Button variant="ghost" onClick={() => setDeciding(null)}>Cancelar</Button>
          <Button variant={deciding?.approve ? "primary" : "danger"} loading={busy} onClick={confirm}>{deciding?.approve ? "Aprobar" : "Rechazar"}</Button></>}>
        <Field label="Nota para el autor (opcional)" htmlFor="dec-note">
          <input id="dec-note" maxLength={500} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
