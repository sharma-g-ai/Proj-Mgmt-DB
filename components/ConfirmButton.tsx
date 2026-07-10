"use client";

// Submits a bound server action after a confirmation prompt. Used for
// destructive/irreversible-ish actions (remove member, delete hours, archive).
export function ConfirmButton({
  action,
  message,
  children,
  className,
}: {
  action: () => Promise<void>;
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
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
