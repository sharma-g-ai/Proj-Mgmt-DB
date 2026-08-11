"use client";

// Submits a bound server action after a confirmation prompt. Used for
// destructive/irreversible-ish actions (remove member, delete hours, archive).
export function ConfirmButton({
  action,
  message,
  children,
  className,
}: {
  action: () => Promise<unknown>;
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  async function run(_formData: FormData): Promise<void> {
    await action();
  }

  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
