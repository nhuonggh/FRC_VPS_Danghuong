import { APP_NAME } from "@/lib/version";

export function Footer() {
  return (
    <footer className="hidden h-8 shrink-0 items-center justify-center border-t border-border bg-surface text-xs text-fg-muted lg:flex">
      © {new Date().getFullYear()} {APP_NAME}
    </footer>
  );
}
