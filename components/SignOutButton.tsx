// Spec 04 §6 — sign out. Plain form POST to the route handler; no client JS needed.
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        Sign out
      </button>
    </form>
  );
}
