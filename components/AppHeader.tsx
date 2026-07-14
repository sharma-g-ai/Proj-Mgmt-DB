"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import type { Profile } from "@/lib/types";

// Shared header for authenticated app pages.
export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center">
            <img src="/amzur-logo.jpg" alt="Amzur" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink href="/dashboard" pathname={pathname}>Leadership Dashboard</NavLink>
            <NavLink href="/projects" pathname={pathname}>Projects</NavLink>
            <NavLink href="/reports" pathname={pathname}>Reports</NavLink>
            {profile.role === "Admin" && (
              <NavLink href="/users" pathname={pathname}>Users</NavLink>
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

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`border-b-2 pb-0.5 ${
        active
          ? "border-brand-600 font-medium text-brand-700"
          : "border-transparent text-gray-600 hover:text-brand-700"
      }`}
    >
      {children}
    </Link>
  );
}
