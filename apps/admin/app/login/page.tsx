import { GalleryVerticalEnd } from "lucide-react";

import { loginWithDiscord } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const callbackUrl = params.callbackUrl ?? "/";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          Grimkeeper
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>
              Sign in with Discord. Admins see the full panel; storytellers see their games; everyone
              can view their player stats.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <p className="text-sm text-destructive">
                Sign-in failed ({error}). Try again, or check Discord OAuth configuration.
              </p>
            ) : null}
            <form action={loginWithDiscord}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button type="submit" className="w-full">
                Login with Discord
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
