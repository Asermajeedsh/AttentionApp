
import { createOptionalClient } from '../utils/supabase/server'
import HomePageClient from './HomePageClient'

export default async function Home() {
  const supabase = createOptionalClient()
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } }

  return <HomePageClient user={data.user} />
}
