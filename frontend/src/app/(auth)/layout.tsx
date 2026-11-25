import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between bg-night p-12 text-white lg:flex">
        <Logo light />
        <div className="max-w-md">
          <p className="font-display text-[34px] font-semibold leading-[1.15] tracking-tight">
            El trabajo de tu equipo, en orden y a la vista.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Proyectos, incidencias y tickets en un solo lugar. Tableros, cronogramas y calendario conectados en tiempo real.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm">
            <div>
              <dt className="text-white/50">Vistas</dt>
              <dd className="mt-1 font-medium">Kanban · Lista · Timeline</dd>
            </div>
            <div>
              <dt className="text-white/50">Equipos</dt>
              <dd className="mt-1 font-medium">Roles y permisos</dd>
            </div>
            <div>
              <dt className="text-white/50">Datos</dt>
              <dd className="mt-1 font-medium">Aislados por empresa</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} Órbita</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
