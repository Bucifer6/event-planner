import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { businesses } from "./business";
import { staffMembers } from "./staff";
import { createdAt, id, ref, timestamptz } from "./_helpers";

// Platform notices to BUSINESSES (W7). Written through @ed/core/comms only. There is no
// column here that could hold a planner-entered contact: a send is always "to a business".

export const NOTICE_AUDIENCES = ["all", "category", "county"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
export const noticeAudienceSchema = z.enum(NOTICE_AUDIENCES);

export const platformNotices = pgTable(
  "platform_notices",
  {
    id: id(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    audience: text("audience").$type<NoticeAudience>().notNull(),
    categoryId: text("category_id"),
    countyCode: text("county_code"),
    createdByStaffId: ref("created_by_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    sentAt: timestamptz("sent_at").notNull(),
    businessCount: integer("business_count").notNull().default(0),
    emailCount: integer("email_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("platform_notices_sent_idx").on(t.sentAt)],
);

/** Send log: one row per business reached by a notice. */
export const platformNoticeSends = pgTable(
  "platform_notice_sends",
  {
    id: id(),
    noticeId: ref("notice_id")
      .notNull()
      .references(() => platformNotices.id, { onDelete: "cascade" }),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    emailsQueued: integer("emails_queued").notNull().default(0),
    at: timestamptz("at").notNull(),
  },
  (t) => [uniqueIndex("platform_notice_sends_uq").on(t.noticeId, t.businessId)],
);
