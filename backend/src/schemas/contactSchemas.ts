import { z } from "zod";
import { contactStatuses } from "../types/contact.js";

export const contactStatusSchema = z.enum(contactStatuses);

export const contactInfoSchema = z.object({
  public_email: z.string().email().nullable(),
  social_links: z.array(z.string().url()),
  website_url: z.string().url().nullable(),
  contact_status: contactStatusSchema,
  contactability_score: z.number().min(0).max(100).nullable()
});

export const runContactsSchema = z.object({
  result_ids: z.array(z.string().min(1)).optional(),
  require_logged_in_browser: z.boolean().optional().default(true),
  manual_assist: z.boolean().optional().default(true)
});
