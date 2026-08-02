import { redirectAdminNotFound } from "@/lib/not-found";

export default async function UnknownPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  await redirectAdminNotFound({
    route: `/${path.join("/")}`,
    reason: "unmatched_route",
  });
}
