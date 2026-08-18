import * as React from 'react';
export const Dialog: React.FC<{ open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode }>;
export const DialogTrigger: React.FC<React.HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; children?: React.ReactNode }>;
export const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>>;
export const DialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>>;
export const DialogClose: React.FC<React.HTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>;
