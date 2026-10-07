// Staff of the office (user request 2026-10-07): what a task or reminder can be about, and the starting list
// of designations ("Add common designations" on the Staff page; every one can be renamed or removed).
export const RELATED_KINDS = ["employee", "designation", "office"] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];

export const EMPLOYEE_CATEGORIES = ["General", "OBC", "OEC", "SC", "ST", "EWS", "Other"] as const;

// Posts commonly found in a Kerala Health Services office or hospital, senior first.
export const COMMON_DESIGNATIONS = [
  "Medical Officer",
  "Dental Surgeon",
  "Head Nurse",
  "Staff Nurse",
  "Public Health Nurse",
  "Lady Health Supervisor",
  "Health Supervisor",
  "Health Inspector",
  "Junior Public Health Nurse (JPHN)",
  "Junior Health Inspector (JHI)",
  "Pharmacist",
  "Lab Technician",
  "Radiographer",
  "Head Clerk",
  "Senior Clerk",
  "Clerk",
  "Typist",
  "Nursing Assistant",
  "Hospital Attendant",
  "Office Attendant",
  "Driver",
  "Part-time Sweeper",
];
