import { loginWithDiscord } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const callbackUrl = params.callbackUrl ?? "/games";

  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>
            Sign in with Discord. Only users listed in <code>ALLOWED_USER_IDS</code> can access
            this admin UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive">
              Access denied or OAuth failed ({error}). Check that your Discord user ID is in{" "}
              <code>ALLOWED_USER_IDS</code>.
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
  );
}
