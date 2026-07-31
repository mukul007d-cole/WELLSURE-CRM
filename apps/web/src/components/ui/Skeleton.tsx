import { cn } from '../../lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse motion-reduce:animate-none rounded-[6px] bg-line', className)}
    />
  );
}

export function SellerRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 sm:px-6">
      <Skeleton className="h-9 w-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="hidden h-6 w-24 rounded-pill sm:block" />
      <Skeleton className="hidden h-3.5 w-20 md:block" />
    </div>
  );
}
