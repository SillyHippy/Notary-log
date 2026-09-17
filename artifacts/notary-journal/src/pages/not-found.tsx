import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appPath } from "@/lib/app-path";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-bold">This page isn't available</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            This link may be incomplete or out of date. You can return to your journal or view the app's features.
          </p>
          <p className="text-sm text-muted-foreground">
            You do not need to clear your browser data to leave this page.
          </p>
          <div className="flex flex-col gap-3">
            <Button asChild className="min-h-11"><a href={appPath('/')}>Go to Journal</a></Button>
            <Button asChild variant="outline" className="min-h-11"><a href={appPath('/features')}>View Features</a></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
