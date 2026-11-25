export function PageHeader({ title, description, actions, children }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface/60 px-4 pt-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
