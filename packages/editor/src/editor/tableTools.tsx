/**
 * TOOLS: the table actions (insert/delete row and column, alignment, delete table) shared by the desktop
 * TableToolbar and the Table sub-menu registered in features/format.
 */
import { AlignCenter, AlignLeft, AlignRight, BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Columns3, Minus, Rows3, Trash2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TableOp } from './tables';

const minus = (icon: LucideIcon): ReactNode => {
  const Icon = icon;
  return (
    <>
      <Minus size={10} aria-hidden />
      <Icon size={15} aria-hidden />
    </>
  );
};

export const TOOLS: { op: TableOp; label: string; icon: ReactNode; divider?: boolean }[] = [
  { op: 'rowAbove', label: 'Insert row above', icon: <BetweenHorizontalStart size={16} aria-hidden /> },
  { op: 'rowBelow', label: 'Insert row below', icon: <BetweenHorizontalEnd size={16} aria-hidden /> },
  { op: 'colLeft', label: 'Insert column left', icon: <BetweenVerticalStart size={16} aria-hidden /> },
  { op: 'colRight', label: 'Insert column right', icon: <BetweenVerticalEnd size={16} aria-hidden /> },
  { op: 'left', label: 'Align column left', icon: <AlignLeft size={16} aria-hidden />, divider: true },
  { op: 'center', label: 'Align column center', icon: <AlignCenter size={16} aria-hidden /> },
  { op: 'right', label: 'Align column right', icon: <AlignRight size={16} aria-hidden /> },
  { op: 'delRow', label: 'Delete row', icon: minus(Rows3), divider: true },
  { op: 'delCol', label: 'Delete column', icon: minus(Columns3) },
  { op: 'delTable', label: 'Delete table', icon: <Trash2 size={16} aria-hidden /> },
];
