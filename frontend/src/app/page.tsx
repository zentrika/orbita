"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageLoader } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) return router.replace("/login");
    let last: number | null = null;
    try {
      last = Number(localStorage.getItem("orbita-org")) || null;
    } catch {
      /* sin almacenamiento */
    }
    const org = me.organizations.find((o) => o.organization_id === last) ?? me.organizations[0];
    router.replace(org ? `/o/${org.organization_id}` : "/onboarding");
  }, [me, loading, router]);
  return <PageLoader />;
}
