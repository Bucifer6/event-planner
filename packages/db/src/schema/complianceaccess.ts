import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, ref, timestamptz } from "./_helpers";
import { approvalRequests, staffMembers } from "./staff";

// Compliance access to one data subject's records (W8, PRD 19.12): requested by the privacy
// owner for a stated legal reason, approved by TWO other people (three in total), live for a
// limited time. Written through @ed/core/complianceaccess only.

export const COMPLIANCE_SUBJECT_TYPES = ["account"] as const;
export type ComplianceSubjectType = (typeof COMPLIANCE_SUBJECT_TYPES)[number];

export const complianceAccessGrants = pgTable(
  "compliance_access_grants",
  {
    id: id(),
    requesterStaffId: ref("requester_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    subjectType: text("subject_type").$type<ComplianceSubjectType>().notNull(),
    subjectId: text("subject_id").notNull(),
    /** The legal ground, in the requester's words (e.g. "GDPR art. 15 request of 03.02.2027"). */
    legalReason: text("legal_reason").notNull(),
    approvalRequestId: ref("approval_request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "restrict" }),
    /** How long the access lasts once granted. */
    hours: integer("hours").notNull().default(24),
    /** Set when the second other person approved. NULL = not (yet) granted. */
    grantedAt: timestamptz("granted_at"),
    expiresAt: timestamptz("expires_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("compliance_access_grants_subject_idx").on(t.subjectType, t.subjectId),
    index("compliance_access_grants_requester_idx").on(t.requesterStaffId, t.createdAt),
  ],
);
