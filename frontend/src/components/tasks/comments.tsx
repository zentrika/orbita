"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, FileText, History, ImageIcon, Paperclip, Pencil, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Field } from "@/components/ui/misc";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAssignable, useComments, useInvalidateTasks } from "@/lib/queries";
import type { Comment } from "@/lib/types";
import { cn, fmtBytes, fmtDate, fmtRelative } from "@/lib/utils";

const escapeHtml = (t: string) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!).replace(/\n/g, "<br>");
const toPlain = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const highlight = (html: string) => html.replace(/(^|[\s>])@([\w.-]{2,40})/g, '$1<span class="font-medium text-primary">@$2</span>');

/** Hilo de comentarios de una tarea: respuestas, adjuntos, solicitudes de edición y versiones aprobadas. */
export function CommentThread({ orgId, taskId, projectId, canComment, canAttach }: {
  orgId: number; taskId: number; projectId: number; canComment: boolean; canAttach: boolean;
}) {
  const { data } = useComments(orgId, taskId);
  const qc = useQueryClient();
  const invalidate = useInvalidateTasks(orgId);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [versionsOf, setVersionsOf] = useState<Comment | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["comments", orgId, taskId] }); invalidate(taskId); };

  const { roots, replies } = useMemo(() => {
    const list = data ?? [];
    const r: Record<number, Comment[]> = {};
    for (const c of list) if (c.parent_id) (r[c.parent_id] ??= []).push(c);
    return { roots: list.filter((c) => !c.parent_id || !list.some((x) => x.id === c.parent_id)), replies: r };
  }, [data]);

  const remove = async (c: Comment) => {
    if (!confirm("¿Eliminar tu comentario? Se conservará en el historial de auditoría.")) return;
    await api(`/orgs/${orgId}/tasks/${taskId}/comments/${c.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    refresh();
  };

  const Item = ({ c, nested }: { c: Comment; nested?: boolean }) => (
    <li className={cn("group flex gap-3", nested && "mt-3")}>
      <Avatar user={c.author} size={nested ? 24 : 28} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
          <span className="font-semibold">{c.author?.full_name ?? "Usuario eliminado"}</span>
          <span className="text-xs text-ink-3">{fmtRelative(c.created_at)}</span>
          {c.version > 1 && (
            <button onClick={() => setVersionsOf(c)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-primary">
              <History className="h-3 w-3" /> editado (v{c.version})
            </button>
          )}
          {c.edit_pending && <span className="chip h-5 bg-risk/10 px-1.5 text-2xs text-[#B54708] dark:text-risk">Edición pendiente de aprobación</span>}
        </p>
        <div className="prose-orbita mt-0.5 break-words" dangerouslySetInnerHTML={{ __html: highlight(c.body) }} />
        {c.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {c.attachments.map((a) => (
              <button key={a.id} onClick={() => downloadFile(`/orgs/${orgId}/tasks/${taskId}/attachments/${a.id}/download`, a.filename).catch((e) => toast.error(e.message))}
                className="inline-flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs hover:border-line-strong">
                {a.content_type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5 text-primary" /> : <FileText className="h-3.5 w-3.5 text-primary" />}
                <span className="truncate">{a.filename}</span>
                <span className="shrink-0 text-ink-3">{fmtBytes(a.size)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex gap-3 text-xs text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {canComment && <button onClick={() => setReplyTo(nested ? roots.find((r) => r.id === c.parent_id) ?? c : c)} className="hover:text-ink">Responder</button>}
          {c.can_request_edit && <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 hover:text-ink"><Pencil className="h-3 w-3" />Solicitar edición</button>}
          {c.can_delete && <button onClick={() => remove(c)} className="hover:text-blocked">Eliminar</button>}
        </div>
      </div>
    </li>
  );

  return (
    <div>
      <ul className="space-y-5">
        {roots.map((c) => (
          <li key={c.id}>
            <ul><Item c={c} /></ul>
            {!!replies[c.id]?.length && (
              <ul className="ml-[14px] border-l border-line pl-5">{replies[c.id].map((r) => <Item key={r.id} c={r} nested />)}</ul>
            )}
          </li>
        ))}
        {data?.length === 0 && <li className="text-[13px] text-ink-3">Sé el primero en comentar.</li>}
      </ul>
      {canComment && (
        <Composer orgId={orgId} taskId={taskId} projectId={projectId} canAttach={canAttach} replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)} onSent={() => { setReplyTo(null); refresh(); }} />
      )}
      {editing && <EditRequestDialog orgId={orgId} taskId={taskId} comment={editing} onClose={() => { setEditing(null); refresh(); }} />}
      {versionsOf && <VersionsDialog orgId={orgId} taskId={taskId} comment={versionsOf} onClose={() => setVersionsOf(null)} />}
    </div>
  );
}

function Composer({ orgId, taskId, projectId, canAttach, replyTo, onCancelReply, onSent }: {
  orgId: number; taskId: number; projectId: number; canAttach: boolean; replyTo: Comment | null; onCancelReply: () => void; onSent: () => void;
}) {
  const { me } = useAuth();
  const { data: people } = useAssignable(orgId, projectId);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handle = (u: { email: string }) => u.email.split("@")[0];
  const suggestions = mention !== null ? (people ?? []).filter((u) => u.full_name.toLowerCase().includes(mention) || handle(u).toLowerCase().includes(mention)).slice(0, 5) : [];

  const onChange = (v: string) => {
    setBody(v);
    const caret = ta.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@([\w.-]*)$/);
    setMention(m ? m[1].toLowerCase() : null);
  };
  const pick = (u: { email: string }) => {
    const caret = ta.current?.selectionStart ?? body.length;
    setBody(body.slice(0, caret).replace(/@([\w.-]*)$/, `@${handle(u)} `) + body.slice(caret));
    setMention(null);
    ta.current?.focus();
  };
  const addFiles = (list: FileList | null) => {
    const next = [...files];
    for (const f of Array.from(list ?? [])) {
      if (f.size > 25 * 1024 * 1024) toast.error(`${f.name} supera 25 MB`);
      else next.push(f);
    }
    setFiles(next.slice(0, 5));
  };
  const send = async () => {
    if (!body.trim() && !files.length) return;
    setSending(true);
    try {
      const text = body.trim() || (files.length === 1 ? `Adjunto: ${files[0].name}` : `Adjuntos: ${files.map((f) => f.name).join(", ")}`);
      const c = await api<Comment>(`/orgs/${orgId}/tasks/${taskId}/comments`, {
        method: "POST", body: { body: `<p>${escapeHtml(text)}</p>`, parent_id: replyTo?.id ?? null },
      });
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("comment_id", String(c.id));
        await api(`/orgs/${orgId}/tasks/${taskId}/attachments`, { method: "POST", body: fd }).catch((e) => toast.error(`${f.name}: ${e.message}`));
      }
      setBody("");
      setFiles([]);
      onSent();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSending(false);
  };

  return (
    <div className="relative mt-5 flex gap-3">
      <Avatar user={me} size={28} />
      <div
        className="flex-1 rounded-lg border border-line bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"
        onDragOver={(e) => canAttach && e.preventDefault()}
        onDrop={(e) => { if (canAttach) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}
      >
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-2">
            <CornerDownRight className="h-3 w-3" /> Respondiendo a <strong className="text-ink">{replyTo.author?.full_name}</strong>
            <button onClick={onCancelReply} className="ml-auto rounded p-0.5 hover:bg-subtle" aria-label="Cancelar respuesta"><X className="h-3 w-3" /></button>
          </div>
        )}
        <textarea
          ref={ta}
          value={body}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => { if (canAttach && e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pick(suggestions[0]); }
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          rows={2}
          placeholder={replyTo ? "Escribe tu respuesta…" : "Escribe un comentario… usa @ para mencionar"}
          className="block w-full resize-none rounded-lg bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-ink-3"
          aria-label="Nuevo comentario"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md bg-subtle px-2 py-1 text-xs">
                {f.type.startsWith("image/") ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                <span className="truncate">{f.name}</span>
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            {canAttach && (
              <>
                <button onClick={() => fileInput.current?.click()} className="rounded-md p-1.5 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Adjuntar imagen o documento" title="Adjuntar imagen o documento">
                  <Paperclip className="h-4 w-4" />
                </button>
                <input ref={fileInput} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.zip,.json"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </>
            )}
            <span className="text-2xs text-ink-3">⌘ + Enter para enviar</span>
          </div>
          <Button size="sm" onClick={send} loading={sending} disabled={!body.trim() && !files.length}>{replyTo ? "Responder" : "Comentar"}</Button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-10 z-10 mb-1 w-64 rounded-xl border border-line bg-surface p-1 shadow-md" role="listbox">
          {suggestions.map((u) => (
            <li key={u.id}>
              <button onMouseDown={(e) => { e.preventDefault(); pick(u); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                <Avatar user={u} size={20} />
                <span className="flex-1 truncate">{u.full_name}</span>
                <span className="text-2xs text-ink-3">@{handle(u)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditRequestDialog({ orgId, taskId, comment, onClose }: { orgId: number; taskId: number; comment: Comment; onClose: () => void }) {
  const [text, setText] = useState(toPlain(comment.body));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const deadline = new Date(new Date(comment.created_at.endsWith("Z") ? comment.created_at : `${comment.created_at}Z`).getTime() + 48 * 3600 * 1000);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/tasks/${taskId}/comments/${comment.id}/edit-requests`, {
        method: "POST", body: { proposed_body: `<p>${escapeHtml(text.trim())}</p>`, reason },
      });
      toast.success("Solicitud enviada a tu líder");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title="Solicitar edición del comentario"
      description={`Los comentarios no se editan directamente: tu líder debe aprobar el cambio. Puedes solicitarlo hasta el ${fmtDate(deadline.toISOString(), "d MMM, HH:mm")}.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" form="edit-req" loading={busy}>Enviar solicitud</Button></>}>
      <form id="edit-req" onSubmit={submit} className="space-y-4">
        <div>
          <span className="label">Comentario actual</span>
          <div className="prose-orbita rounded-lg bg-subtle px-3 py-2" dangerouslySetInnerHTML={{ __html: comment.body }} />
        </div>
        <Field label="Texto propuesto" htmlFor="er-text">
          <textarea id="er-text" required rows={4} className="input h-auto py-2" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Motivo de la edición" htmlFor="er-reason">
          <input id="er-reason" required minLength={5} maxLength={500} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: corregí una cifra" />
        </Field>
      </form>
    </Dialog>
  );
}

function VersionsDialog({ orgId, taskId, comment, onClose }: { orgId: number; taskId: number; comment: Comment; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["comment-versions", comment.id],
    queryFn: () => api<{ version: number; body: string; created_at: string; edit_request_id: number | null }[]>(
      `/orgs/${orgId}/tasks/${taskId}/comments/${comment.id}/versions`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Versiones del comentario" description="Cada versión es inmutable. La primera es el texto original.">
      <ol className="space-y-3">
        {data?.map((v) => (
          <li key={v.version} className="rounded-lg border border-line p-3">
            <p className="mb-1 text-xs text-ink-2">
              <strong className="text-ink">v{v.version}</strong> · {v.version === 1 ? "Original" : "Aprobada"} · {fmtDate(v.created_at, "d MMM yyyy, HH:mm")}
            </p>
            <div className="prose-orbita" dangerouslySetInnerHTML={{ __html: v.body }} />
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
