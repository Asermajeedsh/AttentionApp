import { createOptionalClient } from '../../utils/supabase/server'
import HomePageClient from '../HomePageClient'

export default async function AppHome() {
  const supabase = await createOptionalClient()
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } }
  return <HomePageClient user={data.user} />
}
