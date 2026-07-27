import { redirect } from "next/navigation";

import { getAccessProfile, homePathForAccess } from "@/lib/access";

export default async function HomePage() {
  const access = await getAccessProfile();
  if (!access) redirect("/login");
  redirect(homePathForAccess(access));
}
