import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn merges conditional class names and de-duplicates Tailwind utilities.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
