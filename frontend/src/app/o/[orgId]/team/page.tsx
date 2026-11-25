"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, MailPlus, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Field, PageLoader, Segmented } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useInvitations, useMembers, useOrgId, useTeams } from "@/lib/queries";
import type { Invitation, OrgRole, Team } from "@/lib/types";
import { cn, fmtDate, fmtRelative, ROLE_LABEL, SWATCHES } from "@/lib/utils";

const ROLE_HELP: Record<OrgRole, string> = {
  owner: "Control total, incluida la facturación y la propiedad.",
  admin: "Gestiona miembros, equipos y todos los proyectos.",
  pmo: "Gerente de proyectos: crea, asigna y borra tareas en todos los proyectos; da seguimiento a las aprobaciones.",
  member: "Crea proyectos y trabaja en los proyectos abiertos.",
  guest: "Cliente o externo: sólo ve proyectos a los que se le añade.",
};

export default function TeamPage() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const myRole = me?.organizations.find((o) => o.organization_id === orgId)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";
  const { data: members } = useMembers(orgId);
  const { data: invitations } = useInvitations(orgId, isAdmin);
  const { data: teams } = useTeams(orgId);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"members" | "teams">("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamDlg, setTeamDlg] = useState<{ open: boolean; team?: Team }>({ open: false });

  if (!members) return <PageLoader />;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["members", orgId] });
    qc.invalidateQueries({ queryKey: ["invitations", orgId] });
    qc.invalidateQueries({ queryKey: ["teams", orgId] });
  };
  const call = async (path: string, method: string, body?: unknown, ok?: string) => {
    try { await api(`/orgs/${orgId}${path}`, { method, body }); if (ok) toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <PageHeader
        title="Equipo"
        description={`${members.length} personas en la organización`}
        actions={isAdmin && (
          tab === "members"
            ? <Button onClick={() => setInviteOpen(true)}><MailPlus className="h-4 w-4" /> Invitar personas</Button>
            : <Button onClick={() => setTeamDlg({ open: true })}><Plus className="h-4 w-4" /> Nuevo equipo</Button>
        )}
      >
        <div className="pb-3"><Segmented value={tab} onChange={setTab} options={[{ value: "members", label: "Miembros" }, { value: "teams", label: `Equipos${teams?.length ? ` · ${teams.length}` : ""}` }]} /></div>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-8">
        {tab === "members" ? (
          <>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th className="px-4 py-2.5 font-medium">Persona</th>
                    <th className="px-4 py-2.5 font-medium">Cargo</th>
                    <th className="px-4 py-2.5 font-medium">Rol</th>
                    <th className="px-4 py-2.5 font-medium">Desde</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {members.map((m) => {
                    const self = m.user.id === me?.id;
                    const canChange = isAdmin && !(m.role === "owner" && myRole !== "owner");
                    return (
                      <tr key={m.user.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar user={m.user} size={32} />
                            <div className="min-w-0">
                              <p className="font-medium">{m.user.full_name}{self && <span className="ml-1.5 text-xs font-normal text-ink-3">(tú)</span>}</p>
                              <p className="text-xs text-ink-2">{m.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-2">
                          {isAdmin ? (
                            <input defaultValue={m.title} placeholder="—" onBlur={(e) => e.target.value !== m.title && call(`/members/${m.user.id}`, "PATCH", { title: e.target.value })}
                              className="h-8 w-44 rounded-md bg-transparent px-2 outline-none hover:bg-subtle focus:bg-subtle" aria-label="Cargo" />
                          ) : m.title || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {canChange ? (
                            <select value={m.role} onChange={(e) => call(`/members/${m.user.id}`, "PATCH", { role: e.target.value }, "Rol actualizado")} className="input h-8 w-40 text-[13px]" aria-label="Rol">
                              {(["owner", "admin", "pmo", "member", "guest"] as OrgRole[]).filter((r) => r !== "owner" || myRole === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                            </select>
                          ) : <span className="text-ink-2">{ROLE_LABEL[m.role]}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-2">{fmtDate(m.joined_at, "d MMM yyyy")}</td>
                        <td className="px-2 py-3">
                          {(canChange || self) && (
                            <Button size="icon-sm" variant="ghost" aria-label={self ? "Salir de la organización" : "Quitar miembro"}
                              onClick={() => confirm(self ? "¿Salir de la organización?" : `¿Quitar a ${m.user.full_name}?`) && call(`/members/${m.user.id}`, "DELETE", undefined, "Miembro eliminado").then(() => self && (window.location.href = "/"))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {isAdmin && !!invitations?.length && (
              <section className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">Invitaciones pendientes</h2>
                <ul className="divide-y divide-line">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3"><MailPlus className="h-3.5 w-3.5" /></span>
                      <span className="flex-1">{i.email}</span>
                      <span className="text-xs text-ink-2">{ROLE_LABEL[i.role]}</span>
                      <span className="hidden text-xs text-ink-3 sm:inline">Enviada {fmtRelative(i.created_at)} · caduca {fmtDate(i.expires_at)}</span>
                      <Button size="icon-sm" variant="ghost" onClick={() => call(`/invitations/${i.id}`, "DELETE", undefined, "Invitación revocada")} aria-label="Revocar"><X className="h-3.5 w-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams?.map((t) => (
              <div key={t.id} className="card overflow-hidden p-5" style={{ borderTop: `3px solid ${t.color}` }}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                      {t.name}{t.is_qa && <span className="chip h-5 bg-review/10 px-1.5 text-2xs text-review">QA</span>}
                    </h3>
                    {t.description && <p className="mt-0.5 text-sm text-ink-2">{t.description}</p>}
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
                      Líder: {t.lead ? <><Avatar user={t.lead} size={18} /><span className="font-medium text-ink">{t.lead.full_name}</span></> : <span>sin líder</span>}
                    </p>
                  </div>
                  {isAdmin && <Button size="sm" variant="ghost" onClick={() => setTeamDlg({ open: true, team: t })}>Editar</Button>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {t.members.filter((u) => u.id !== t.lead?.id).map((u) => <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-subtle py-0.5 pl-0.5 pr-2.5 text-xs"><Avatar user={u} size={20} />{u.full_name}</span>)}
                  {!t.members.length && <span className="text-sm text-ink-3">Sin miembros</span>}
                </div>
              </div>
            ))}
            {!teams?.length && <p className="text-sm text-ink-3">Aún no hay equipos. Agrupa personas por área (Diseño, Ingeniería…).</p>}
          </div>
        )}
      </div>
      {inviteOpen && <InviteDialog orgId={orgId} isOwner={myRole === "owner"} onClose={() => { setInviteOpen(false); refresh(); }} />}
      {teamDlg.open && <TeamDialog orgId={orgId} team={teamDlg.team} members={members.map((m) => m.user)} onClose={() => { setTeamDlg({ open: false }); refresh(); }} />}
    </>
  );
}

function InviteDialog({ orgId, isOwner, onClose }: { orgId: number; isOwner: boolean; onClose: () => void }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    setBusy(true);
    const created: { email: string; url: string }[] = [];
    for (const email of list) {
      try {
        const inv = await api<Invitation>(`/orgs/${orgId}/invitations`, { method: "POST", body: { email, role } });
        if (inv.invite_url) created.push({ email, url: inv.invite_url });
      } catch (err) { toast.error(`${email}: ${(err as Error).message}`); }
    }
    setBusy(false);
    if (created.length || list.length) toast.success("Invitaciones enviadas");
    if (created.length) setLinks(created);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Invitar personas" description="Recibirán un correo con un enlace válido durante 7 días."
      footer={links.length ? <Button onClick={onClose}>Listo</Button> : <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="invite" loading={busy}>Enviar invitaciones</Button></>}>
      {links.length ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">En desarrollo también puedes compartir el enlace directamente:</p>
          {links.map((l) => (
            <div key={l.email} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
              <span className="flex-1 truncate">{l.email}</span>
              <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(l.url); toast.success("Enlace copiado"); }}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
            </div>
          ))}
        </div>
      ) : (
        <form id="invite" onSubmit={submit} className="space-y-4">
          <Field label="Correos" htmlFor="emails" hint="Separa varios con comas o saltos de línea.">
            <textarea id="emails" required rows={3} className="input h-auto py-2" placeholder="ana@empresa.com, pedro@empresa.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
          </Field>
          <div>
            <span className="label">Rol</span>
            <div className="space-y-2">
              {(["admin", "pmo", "member", "guest", ...(isOwner ? ["owner"] : [])] as OrgRole[]).map((r) => (
                <label key={r} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="mt-0.5 accent-primary" />
                  <span><span className="block text-[13px] font-medium">{ROLE_LABEL[r]}</span><span className="block text-xs text-ink-2">{ROLE_HELP[r]}</span></span>
                </label>
              ))}
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function TeamDialog({ orgId, team, members, onClose }: { orgId: number; team?: Team; members: { id: number; full_name: string }[]; onClose: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [ids, setIds] = useState<number[]>(team?.members.map((m) => m.id) ?? []);
  const [lead, setLead] = useState<number | "">(team?.lead?.id ?? "");
  const [isQa, setIsQa] = useState(team?.is_qa ?? false);
  const [color, setColor] = useState(team?.color ?? SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/teams${team ? `/${team.id}` : ""}`, {
        method: team ? "PATCH" : "POST",
        body: { name, description, member_ids: ids, lead_id: lead === "" ? null : lead, is_qa: isQa, color },
      });
      onClose();
    } catch (err) { toast.error((err as Error).message); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={team ? "Editar equipo" : "Nuevo equipo"}
      description="El líder edita, reasigna y transfiere las tareas de su equipo, y aprueba las ediciones de comentarios de sus integrantes."
      footer={<>
        {team && <Button variant="ghost" className="mr-auto text-blocked" onClick={async () => { if (confirm("¿Eliminar equipo? Sus tareas quedarán sin equipo.")) { await api(`/orgs/${orgId}/teams/${team.id}`, { method: "DELETE" }); onClose(); } }}>Eliminar</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="team" loading={busy}>Guardar</Button>
      </>}>
      <form id="team" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Nombre" htmlFor="t-name"><input id="t-name" required minLength={2} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Team 404" /></Field>
          <div>
            <span className="label">Color</span>
            <div className="flex h-9 items-center gap-1">
              {SWATCHES.slice(0, 7).map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                  className={cn("h-6 w-6 rounded-md", color === c && "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface")} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <Field label="Descripción" htmlFor="t-desc"><input id="t-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Desarrollo backend, QA, soporte…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Líder" htmlFor="t-lead">
            <select id="t-lead" className="input" value={lead} onChange={(e) => setLead(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Sin líder</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </Field>
          <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 text-[13px] has-[:checked]:border-review has-[:checked]:bg-review/[0.06]">
            <input type="checkbox" className="mt-0.5 accent-[#8B5CF6]" checked={isQa} onChange={(e) => setIsQa(e.target.checked)} />
            <span><span className="block font-medium">Equipo de QA</span><span className="text-xs text-ink-2">Valida entregas en los proyectos donde tiene acceso.</span></span>
          </label>
        </div>
        <div>
          <span className="label">Integrantes</span>
          <div className="scroll-thin max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {members.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-subtle">
                <input type="checkbox" className="accent-primary" checked={ids.includes(m.id) || lead === m.id} disabled={lead === m.id}
                  onChange={() => setIds(ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id])} />
                {m.full_name}{lead === m.id && <span className="text-2xs text-ink-3">líder</span>}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
