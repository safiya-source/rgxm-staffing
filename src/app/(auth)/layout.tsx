import Link from "next/link";
import { Logo } from "@/components/app/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 pt-6 sm:px-8">
        <Link href="/" aria-label="RGXM Crew home">
          <Logo suffix="Crew" />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-6 text-xs text-muted-foreground sm:px-8">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Platform Terms of Use
        </Link>
        <Link href="/contractor-agreement" className="hover:text-foreground">
          Contractor Agreement
        </Link>
      </footer>
    </div>
  );
}
