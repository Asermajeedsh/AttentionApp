import { createOptionalClient } from '../../utils/supabase/server'
import PulseExperience from '../../components/pulse/PulseExperience'

export default async function ChatPage() {
  const supabase = await createOptionalClient()
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } }
  return <PulseExperience user={data.user} mode="messages" />
}
