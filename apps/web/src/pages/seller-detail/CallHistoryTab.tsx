import { EmptyState } from '../../components/ui/EmptyState';

/**
 * Deliberately a placeholder.
 *
 * There is no telephony anywhere in this system — no call model, no provider
 * integration, and `activity_logs.recording_reference_url` is a column nothing
 * writes. Calls will arrive from the Android app. Showing an honest empty state
 * beats inventing rows that would look like data during a demo.
 */
export function CallHistoryTab() {
  return (
    <EmptyState
      title="Call history isn’t connected yet"
      description="Calls will appear here once the Android app starts reporting them. Nothing in the web app places or logs calls today."
    />
  );
}
