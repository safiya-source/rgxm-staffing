import {
  BarChart3Icon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ClockIcon,
  LayoutDashboardIcon,
  SendIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/authz/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission };

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/dashboard/projects", label: "Projects", icon: BriefcaseIcon, permission: "project.view" },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDaysIcon, permission: "project.view" },
  { href: "/dashboard/talent", label: "Talent", icon: UsersIcon, permission: "talent.view" },
  { href: "/dashboard/staffing", label: "Staffing Requests", icon: SendIcon, permission: "booking.offer" },
  { href: "/dashboard/timesheets", label: "Timesheets", icon: ClockIcon, permission: "timesheet.view" },
  { href: "/dashboard/payments", label: "Payments", icon: WalletIcon, permission: "payments.view" },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3Icon, permission: "reports.view" },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];
