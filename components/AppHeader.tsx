import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import type { Profile } from "@/lib/types";

// Shared header for authenticated app pages.
export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            PM Dashboard
          </Link>
          <nav className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/dashboard" className="hover:text-gray-900">
              Dashboard
            </Link>
            <Link href="/projects" className="hover:text-gray-900">
              Projects
            </Link>
            <Link href="/reports" className="hover:text-gray-900">
              Reports
            </Link>
            {profile.role === "Admin" && (
              <Link href="/users" className="hover:text-gray-900">
                Users
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {profile.full_name} · {profile.role}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
