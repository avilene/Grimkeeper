import { redirectAdminNotFound } from "@/lib/not-found";

export default async function NotFound() {
  await redirectAdminNotFound({
    reason: "next_not_found_boundary",
  });
}
