"use client";
import { tr } from "@/lib/i18n";


import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center space-y-2 text-center">
      <h1 className="font-semibold text-2xl">{tr("Page not found.")}</h1>
      <p className="text-muted-foreground">{tr("The page you are looking for could not be found.")}</p>
      <Link prefetch={false} replace href="/function/tasks">
        <Button variant="outline">{tr("Go back home")}</Button>
      </Link>
    </div>
  );
}
