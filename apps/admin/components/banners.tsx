import { Alert, AlertDescription } from "@/components/ui/alert";

export function FlashBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="info" className="mb-4">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="warning" className="mb-4">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
