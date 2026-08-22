import type { TicketPriority, TicketStatus } from "@restaurant/types";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_customer: "Waiting on customer",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  open: "warning",
  in_progress: "info",
  waiting_customer: "warning",
  resolved: "success",
  closed: "neutral",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const TICKET_PRIORITY_TONE: Record<TicketPriority, "neutral" | "info" | "warning" | "success" | "danger"> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};
