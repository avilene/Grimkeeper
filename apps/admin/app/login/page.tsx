import { GalleryVerticalEnd } from "lucide-react";

import { DiscordLoginButton } from "@/components/discord-login-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function errorMessage(error: string): string {
  switch (error) {
    case "Configuration":
      return "Sign-in failed (server auth configuration). Check ADMIN_SESSION_SECRET / AUTH_SECRET, DISCORD_CLIENT_SECRET, and that Discord OAuth redirects match ADMIN_OAUTH_CALLBACK_URL.";
    case "AccessDenied":
      return "Sign-in was denied.";
    case "OAuthCallbackError":
      return "Discord returned an error during callback. Check the client secret and redirect URL in the Discord Developer Portal.";
    case "MissingCSRF":
      return "Sign-in failed (CSRF). Refresh the page and try again.";
    default:
      return `Sign-in failed (${error}). Try again, or check Discord OAuth configuration.`;
  }
}

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
              <p className="text-sm text-destructive">{errorMessage(error)}</p>
            ) : null}
            <DiscordLoginButton callbackUrl={callbackUrl} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
