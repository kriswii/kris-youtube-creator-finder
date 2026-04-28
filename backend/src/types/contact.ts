export const contactStatuses = ["pending", "found", "gated", "not_found", "failed"] as const;
export type ContactStatus = (typeof contactStatuses)[number];

export interface ContactInfo {
  public_email: string | null;
  social_links: string[];
  website_url: string | null;
  contact_status: ContactStatus;
  contactability_score: number | null;
}
