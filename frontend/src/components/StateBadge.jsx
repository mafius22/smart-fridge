import { STATE_LABELS } from '../utils/format';

export default function StateBadge({ state }) {
  return <span className={`badge badge-${state}`}>{STATE_LABELS[state] || state}</span>;
}
