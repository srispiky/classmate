import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string) {
  if (!dateString) return ""
  try {
    return format(parseISO(dateString), "MMM d, yyyy")
  } catch (e) {
    return dateString
  }
}

export function formatDateTime(dateString: string) {
  if (!dateString) return ""
  try {
    return format(parseISO(dateString), "MMM d, yyyy h:mm a")
  } catch (e) {
    return dateString
  }
}
