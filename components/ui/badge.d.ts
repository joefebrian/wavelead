import * as React from 'react';
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}
export const Badge: React.FC<BadgeProps>;
export const badgeVariants: (props?: { variant?: BadgeProps['variant']; className?: string }) => string;
