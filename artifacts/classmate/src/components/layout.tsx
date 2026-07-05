import { Link, useLocation } from "wouter";
import { BookOpen, Users, LayoutDashboard, FileText, CheckSquare, BrainCircuit, Menu, Settings, LogOut, Megaphone, BarChart3, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

const baseNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/students", label: "Students", icon: Users },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/assignments", label: "Assignments", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/assessments", label: "Assessments", icon: BrainCircuit },
];

const teacherNavItems = [
  { href: "/announcements", label: "Announcements", icon: Megaphone },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

const adminNavItems = [
  { href: "/monitoring", label: "Operations", icon: Monitor },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin";
  const isTeacherOrAdmin = isAdmin || user?.role === "teacher";
  const navItems = [
    ...baseNavItems,
    ...(isTeacherOrAdmin ? teacherNavItems : []),
    ...(isAdmin ? adminNavItems : []),
  ];

  const initials = user?.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "?";

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <nav className="flex flex-col gap-1 w-full px-2">
      {navItems.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary-foreground dark:text-white"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              onClick={onClick}
            >
              <item.icon className={cn("w-5 h-5", isActive ? "text-primary dark:text-white" : "text-muted-foreground")} />
              {item.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-sidebar border-r border-sidebar-border shrink-0">
        <div className="p-4 flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight text-sidebar-foreground">Classmate</span>
        </div>
        <NavLinks />
        <div className="mt-auto p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-medium text-sidebar-foreground shrink-0">
              {initials}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium text-sidebar-foreground truncate">{user?.displayName}</span>
              <span className="text-xs text-sidebar-foreground/60 capitalize">{user?.role}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={() => void logout()}
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Nav */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-background fixed top-0 w-full z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Classmate</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => void logout()}
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </Button>
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="w-6 h-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar border-r-0">
              <div className="p-4 flex items-center gap-2 mb-4 mt-8">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg tracking-tight text-sidebar-foreground">Classmate</span>
              </div>
              <NavLinks onClick={() => setMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto w-full">
        <div className="p-4 md:p-8 pt-20 md:pt-8 max-w-7xl mx-auto min-h-[100dvh]">
          {children}
        </div>
      </main>
    </div>
  );
}
