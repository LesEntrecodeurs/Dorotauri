import { useParams } from 'react-router'

export default function Console() {
  const { agentId } = useParams()
  return <div className="p-4">Console: {agentId}</div>
}
