"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "@/app/providers";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field, Segmented } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOrg, useOrgId } from "@/lib/queries";
import { cn, fmtDate, fmtRelative, ROLE_LABEL, SWATCHES } from "@/lib/utils";

interface Session { id: number; user_agent: string; ip_address: string; created_at: string; last_used_at: string; current: boolean }

function Settings() {
  const orgId = useOrgId();
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const role = me?.organizations.find((o) => o.organization_id === orgId)?.role;
  const isAdmin = role === "owner" || role === "admin";
  const tab = (params.get("tab") as "org" | "account") ?? (isAdmin ? "org" : "account");
  return (
    <>
      <PageHeader title="Ajustes">
        <div className="pb-3">
          <Segmented value={tab} onChange={(t) => router.replace(`?tab=${t}`)}
            options={[...(isAdmin ? [{ value: "org" as const, label: "Organización" }] : []), { value: "account" as const, label: "Mi cuenta" }]} />
        </div>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-8">
        {tab === "org" && isAdmin ? <OrgSettings orgId={orgId} /> : <AccountSettings />}
      </div>
    </>
  );
}

const DAYS = [["1", "Lun"], ["2", "Mar"], ["3", "Mié"], ["4", "Jue"], ["5", "Vie"], ["6", "Sáb"], ["7", "Dom"]];

function OrgSettings({ orgId }: { orgId: number }) {
  const { data: org } = useOrg(orgId);
  const { reload } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<{ name: string; timezone: string; workdays: string[]; wip_limit: number } | null>(null);
  const { data: holidays, refetch } = useQuery({ queryKey: ["holidays", orgId], queryFn: () => api<{ id: number; date: string; name: string }[]>(`/orgs/${orgId}/holidays`) });
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");
  if (!org) return null;
  const f = form ?? { name: org.name, timezone: org.timezone, workdays: org.workdays.split(","), wip_limit: org.wip_limit };
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [org.timezone];
  return (
    <>
      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Organización</h2>
        <form className="mt-4 space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/orgs/${orgId}`, { method: "PATCH", body: { name: f.name, timezone: f.timezone, workdays: [...f.workdays].sort().join(","), wip_limit: f.wip_limit } });
            qc.invalidateQueries({ queryKey: ["org", orgId] });
            qc.invalidateQueries({ queryKey: ["office", orgId] });
            await reload();
            setForm(null);
            toast.success("Organización actualizada");
          } catch (err) { toast.error((err as Error).message); }
        }}>
          <Field label="Nombre" htmlFor="o-name"><input id="o-name" required minLength={2} className="input" value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Capacidad por persona" htmlFor="o-wip" hint="Máximo de tareas simultáneas en progreso. Las pendientes no cuentan.">
              <input id="o-wip" type="number" min={1} max={20} className="input" value={f.wip_limit} onChange={(e) => setForm({ ...f, wip_limit: Number(e.target.value) })} />
            </Field>
            <Field label="Zona horaria" htmlFor="o-tz" hint="Define el día de cada contribución para las rachas.">
              <select id="o-tz" className="input" value={f.timezone} onChange={(e) => setForm({ ...f, timezone: e.target.value })}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <span className="label">Días laborales</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([v, l]) => {
                const on = f.workdays.includes(v);
                return (
                  <button type="button" key={v} onClick={() => setForm({ ...f, workdays: on ? f.workdays.filter((x) => x !== v) : [...f.workdays, v] })}
                    className={cn("h-8 w-12 rounded-lg border text-[13px]", on ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-2 hover:bg-subtle")}>{l}</button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="label">Identificador</span><p className="text-ink-2">{org.slug}</p></div>
            <div><span className="label">Plan</span><p className="capitalize text-ink-2">{org.plan}</p></div>
          </div>
          <div className="flex justify-end"><Button type="submit">Guardar</Button></div>
        </form>
      </section>
      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Festivos</h2>
        <p className="mt-0.5 text-sm text-ink-2">Los festivos, fines de semana y ausencias autorizadas no rompen las rachas.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {holidays?.map((h) => (
            <li key={h.id} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line pl-2.5 pr-1 text-[13px]">
              {fmtDate(h.date, "d MMM yyyy")}{h.name && <span className="text-ink-2">· {h.name}</span>}
              <button onClick={async () => { await api(`/orgs/${orgId}/holidays/${h.id}`, { method: "DELETE" }); refetch(); }} className="rounded p-1 text-ink-3 hover:bg-subtle" aria-label="Quitar festivo">×</button>
            </li>
          ))}
          {!holidays?.length && <li className="text-sm text-ink-3">Sin festivos.</li>}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          try { await api(`/orgs/${orgId}/holidays`, { method: "POST", body: { date: hDate, name: hName } }); setHDate(""); setHName(""); refetch(); }
          catch (err) { toast.error((err as Error).message); }
        }}>
          <input type="date" required className="input h-8 w-40 text-[13px]" value={hDate} onChange={(e) => setHDate(e.target.value)} aria-label="Fecha" />
          <input className="input h-8 text-[13px]" placeholder="Nombre (opcional)" value={hName} onChange={(e) => setHName(e.target.value)} />
          <Button size="sm" type="submit">Añadir</Button>
        </form>
      </section>
    </>
  );
}

function AccountSettings() {
  const { me, reload, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState({ full_name: me?.full_name ?? "", avatar_color: me?.avatar_color ?? SWATCHES[0] });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const { data: sessions, refetch } = useQuery({ queryKey: ["sessions"], queryFn: () => api<Session[]>("/auth/sessions") });

  const save = async (body: Record<string, unknown>, ok: string) => {
    try { await api("/auth/me", { method: "PATCH", body }); await reload(); toast.success(ok); return true; } catch (e) { toast.error((e as Error).message); return false; }
  };
  const device = (ua: string) => {
    const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    const os = /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return `${b}${os ? ` en ${os}` : ""}`;
  };

  return (
    <>
      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Perfil</h2>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(profile, "Perfil actualizado"); }}>
          <Field label="Nombre" htmlFor="a-name"><input id="a-name" required minLength={2} className="input" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} /></Field>
          <Field label="Correo" htmlFor="a-mail" hint={me?.email_verified ? "Verificado" : "Pendiente de verificación"}><input id="a-mail" disabled className="input" value={me?.email ?? ""} /></Field>
          <div>
            <span className="label">Color del avatar</span>
            <div className="flex gap-2">
              {SWATCHES.map((c) => (
                <button type="button" key={c} onClick={() => setProfile({ ...profile, avatar_color: c })} aria-label={`Color ${c}`}
                  className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-surface", profile.avatar_color === c && "ring-2 ring-ink/40")} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div>
            <span className="label">Tema</span>
            <Segmented value={theme} onChange={setTheme} options={[
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" />Claro</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" />Oscuro</span> },
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" />Sistema</span> },
            ]} />
          </div>
          <div className="flex justify-end"><Button type="submit">Guardar perfil</Button></div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Contraseña</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(pw, "Contraseña actualizada")) setPw({ current_password: "", new_password: "" });
        }}>
          <Field label="Actual" htmlFor="pw1"><input id="pw1" type="password" required autoComplete="current-password" className="input" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
          <Field label="Nueva" htmlFor="pw2" hint="Mínimo 8 caracteres, letras y números."><input id="pw2" type="password" required minLength={8} autoComplete="new-password" className="input" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit">Cambiar contraseña</Button></div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="text-[15px] font-semibold">Sesiones activas</h2>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
              <Monitor className="h-4 w-4 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{device(s.user_agent)}{s.current && <span className="ml-2 chip h-5 bg-done/10 text-done">Esta sesión</span>}</p>
                <p className="text-xs text-ink-2">{s.ip_address} · activa {fmtRelative(s.last_used_at)}</p>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={async () => { await api(`/auth/sessions/${s.id}`, { method: "DELETE" }); refetch(); }}>Cerrar</Button>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between text-sm">
          <span className="text-ink-2">Organizaciones: {me?.organizations.map((o) => `${o.name} (${ROLE_LABEL[o.role]})`).join(", ")}</span>
          <Button variant="secondary" size="sm" onClick={logout}>Cerrar sesión</Button>
        </div>
      </section>
    </>
  );
}

export default function SettingsPage() {
  return <Suspense><Settings /></Suspense>;
}
