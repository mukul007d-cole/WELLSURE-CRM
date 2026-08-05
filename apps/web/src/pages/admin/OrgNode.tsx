import { RingAvatar } from '../../components/ui/RingAvatar';
import { cn } from '../../lib/cn';
import type { OrgNode as OrgNodeData } from './org-hierarchy';

/**
 * buildHierarchy already breaks reporting loops, so this can't recurse forever.
 * The guard stays as a backstop against a future change reintroducing one.
 */
const MAX_DEPTH = 64;

export interface OrgNodeProps {
  node: OrgNodeData;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matchIds: Set<string>;
  visibleIds: Set<string> | null;
  roleName: (roleId: string) => string | null;
  departmentName: (departmentId: string | null) => string | null;
  query: string;
  density: string;
}

/** Wraps the matched substring so search hits are visible in place. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[2px] bg-gold-soft text-ink">
        {text.slice(index, index + trimmed.length)}
      </mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

export function OrgNode({
  node,
  depth,
  expanded,
  onToggle,
  matchIds,
  visibleIds,
  roleName,
  departmentName,
  query,
  density,
}: OrgNodeProps) {
  if (depth > MAX_DEPTH) return null;
  if (visibleIds && !visibleIds.has(node.user.id)) return null;

  const children = node.children.filter((child) => !visibleIds || visibleIds.has(child.user.id));
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.user.id);
  const role = roleName(node.user.roleId);
  const department = departmentName(node.user.departmentId);

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-level={depth + 1}
      // Nothing here is selectable — the tree is for reading structure, not
      // picking a person — but the role requires the attribute to be present.
      aria-selected={false}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-control px-2 hover:bg-paper',
          density,
          matchIds.has(node.user.id) && 'bg-gold-soft/25',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.user.id)}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.user.name}'s reports`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-line"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={cn(
                'transition-transform motion-reduce:transition-none',
                isOpen && 'rotate-90',
              )}
            >
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" />
        )}

        <RingAvatar name={node.user.name} size={32} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            <Highlighted text={node.user.name} query={query} />
            {node.user.active ? null : (
              <span className="ml-2 rounded-pill bg-status-archived-bg px-2 py-0.5 text-[11px] font-medium text-status-archived">
                Inactive
              </span>
            )}
          </p>
          <p className="truncate text-xs text-ink-soft">
            {role ?? 'Role hidden'}
            {department ? ` · ${department}` : ''}
            {node.rootReason === 'cycle' ? ' · in a reporting loop' : ''}
            {node.rootReason === 'manager_missing' ? ' · manager not visible to you' : ''}
          </p>
        </div>
      </div>

      {hasChildren && isOpen ? (
        <ul role="group" className="ml-5 border-l border-line pl-2">
          {children.map((child) => (
            <OrgNode
              key={child.user.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              matchIds={matchIds}
              visibleIds={visibleIds}
              roleName={roleName}
              departmentName={departmentName}
              query={query}
              density={density}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
