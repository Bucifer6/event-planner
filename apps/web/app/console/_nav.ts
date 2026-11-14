import type { StaffRole } from "@ed/core/staff";

/**
 * THE registry of console sections. The side navigation is built from this list, in order.
 * Later agents (moderation, discovery, directory, businesses, commercial, communications,
 * deployments) APPEND one line each and add the label as `console.nav.<key>` in the `console`
 * i18n namespace (ro + en). Never reorder or edit other lines.
 *
 * `roles`: who sees the entry (omit = every staff member). It only hides the link — each page
 * and each core function still does its own role check.
 */
export type ConsoleNavItem = { key: string; href: string; roles?: StaffRole[]; exact?: boolean };

export const consoleNav: ConsoleNavItem[] = [
  { key: "dashboard", href: "/console", exact: true },
  { key: "approvals", href: "/console/approvals" },
  { key: "audit", href: "/console/audit", roles: ["platform_admin", "security_administrator", "privacy_owner"] },
  { key: "access", href: "/console/access", roles: ["platform_admin", "security_administrator"] },
  { key: "incidents", href: "/console/incidents", roles: ["security_administrator", "platform_admin"] },
  { key: "operations", href: "/console/operations", roles: ["security_administrator", "platform_admin"] },
  { key: "reports", href: "/console/reports", roles: ["listing_moderator", "platform_admin"] },
  { key: "launch", href: "/console/launch", roles: ["platform_admin", "privacy_owner", "security_administrator", "commercial_manager"] },
  { key: "moderation", href: "/console/moderation", roles: ["listing_moderator", "platform_admin"] },
  { key: "businesses", href: "/console/businesses", roles: ["listing_moderator", "platform_admin"] },
  { key: "directory", href: "/console/directory", roles: ["listing_moderator", "platform_admin"] },
  { key: "deploys", href: "/console/deploys", roles: ["platform_admin", "security_administrator"] },
  { key: "complianceAccess", href: "/console/compliance", roles: ["privacy_owner", "platform_admin", "security_administrator"] },
  { key: "commercial", href: "/console/commercial", roles: ["commercial_manager", "platform_admin"] },
  { key: "communications", href: "/console/communications", roles: ["commercial_manager", "content_editor"] },
  { key: "discovery", href: "/console/discovery", roles: ["listing_moderator", "platform_admin"] },
  { key: "help", href: "/help#staff" },
];
