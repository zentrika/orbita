"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getAccessToken, refreshAccessToken } from "./api";

export type RealtimeStatus = "connecting" | "online" | "offline";

interface RtEvent {
  type: string;
  org_id?: number;
  project_id?: number;
  task_id?: number;
}

function wsUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:8000/api/v1/ws`;
}

/**
 * Mantiene un WebSocket por organización. Los eventos sólo traen ids;
 * invalidamos las consultas afectadas y React Query vuelve a pedirlas (con permisos).
 */
export function useRealtime(orgId: number) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const retry = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      const token = getAccessToken() ?? (await refreshAccessToken());
      if (!token || closed) return;
      setStatus("connecting");
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token, org_id: orgId }));
      ws.onmessage = (msg) => {
        const ev: RtEvent = JSON.parse(msg.data);
        if (ev.type === "ready") {
          retry.current = 0;
          setStatus("online");
          ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
          return;
        }
        handle(ev);
      };
      ws.onclose = async (e) => {
        clearInterval(ping);
        if (closed) return;
        setStatus("offline");
        if (e.code === 4401) await refreshAccessToken();
        const delay = Math.min(30000, 1000 * 2 ** retry.current++);
        timer = setTimeout(connect, delay);
      };
    };

    const handle = (ev: RtEvent) => {
      if (ev.type === "presence") {
        qc.invalidateQueries({ queryKey: ["office", orgId] });
        return;
      }
      if (ev.type === "achievements.updated") {
        qc.invalidateQueries({ queryKey: ["performance", orgId] });
        qc.invalidateQueries({ queryKey: ["achievements", orgId] });
        return;
      }
      if (ev.type === "notification") {
        qc.invalidateQueries({ queryKey: ["notifications", orgId] });
        qc.invalidateQueries({ queryKey: ["edit-requests", orgId] });
        if (document.visibilityState === "visible") toast("Tienes una nueva notificación");
        return;
      }
      if (ev.type.startsWith("task.") || ev.type.startsWith("comment.")) {
        qc.invalidateQueries({ queryKey: ["tasks", orgId] });
        qc.invalidateQueries({ queryKey: ["dashboard", orgId] });
        qc.invalidateQueries({ queryKey: ["my-work", orgId] });
        qc.invalidateQueries({ queryKey: ["relations", orgId] });
        qc.invalidateQueries({ queryKey: ["office", orgId] });
        if (ev.type === "comment.updated") qc.invalidateQueries({ queryKey: ["edit-requests", orgId] });
        if (ev.task_id) {
          qc.invalidateQueries({ queryKey: ["eligible", orgId, ev.task_id] });
          qc.invalidateQueries({ queryKey: ["task", orgId, ev.task_id] });
          qc.invalidateQueries({ queryKey: ["comments", orgId, ev.task_id] });
          qc.invalidateQueries({ queryKey: ["attachments", orgId, ev.task_id] });
          qc.invalidateQueries({ queryKey: ["task-activity", orgId, ev.task_id] });
        }
      }
      if (ev.type.startsWith("project.") || ev.type.startsWith("task.")) {
        qc.invalidateQueries({ queryKey: ["projects", orgId] });
        if (ev.project_id) qc.invalidateQueries({ queryKey: ["project", orgId, ev.project_id] });
      }
    };

    connect();
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      ws?.close();
    };
  }, [orgId, qc]);

  return status;
}
